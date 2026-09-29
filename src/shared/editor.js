// 메모 본문 편집기. 데스크톱 메모 창과 아이폰 편집 화면이 같이 써.
import { sanitize } from './notes.js';
import { icon } from './icons.js';
import { imageToDataURL } from './image.js';

const IS_APPLE = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MOD = IS_APPLE ? '⌘' : 'Ctrl+';

const TOOLS = [
  { cmd: 'bold', label: 'B', title: '굵게', key: 'B' },
  { cmd: 'italic', label: 'I', title: '기울임꼴', key: 'I' },
  { cmd: 'underline', label: 'U', title: '밑줄', key: 'U' },
  { cmd: 'strikeThrough', label: 'S', title: '취소선', key: 'T' },
  { cmd: 'bullets', icon: 'bullets', title: '글머리 기호', key: IS_APPLE ? '⇧L' : 'Shift+L' },
  { cmd: 'checklist', icon: 'checklist', title: '체크리스트' },
  { cmd: 'image', icon: 'image', title: '사진 추가' },
];

export function createEditor(el, { tools, onChange, placeholder = '메모를 입력하세요…' } = {}) {
  el.contentEditable = 'true';
  el.spellcheck = false;
  el.classList.add('editor');
  el.dataset.placeholder = placeholder;
  el.setAttribute('role', 'textbox');
  el.setAttribute('aria-multiline', 'true');
  el.setAttribute('autocapitalize', 'sentences');
  document.execCommand('defaultParagraphSeparator', false, 'div');

  const blank = () => !el.querySelector('img,li') && el.textContent.trim() === '';
  const refreshEmpty = () => el.classList.toggle('is-empty', blank());
  const emit = () => { refreshEmpty(); onChange?.(el.innerHTML); };

  // ── 선택 영역 도우미 ─────────────────────────────
  const selection = () => document.getSelection();
  function currentNode() {
    const s = selection();
    if (!s || !s.rangeCount || !el.contains(s.anchorNode)) return null;
    const n = s.anchorNode;
    return n.nodeType === 1 ? n : n.parentElement;
  }
  function closest(sel) {
    const hit = currentNode()?.closest(sel);
    return hit && el.contains(hit) ? hit : null;
  }
  function saveRange() {
    const s = selection();
    return s && s.rangeCount && el.contains(s.anchorNode) ? s.getRangeAt(0).cloneRange() : null;
  }
  function restoreRange(r) {
    el.focus({ preventScroll: true });
    const s = selection();
    s.removeAllRanges();
    if (r) s.addRange(r);
    else {
      const end = document.createRange();
      end.selectNodeContents(el);
      end.collapse(false);
      s.addRange(end);
    }
  }
  function exec(cmd, value) {
    if (!el.contains(selection()?.anchorNode)) restoreRange(null);
    document.execCommand(cmd, false, value);
  }

  // ── 명령 ────────────────────────────────────────
  function run(cmd) {
    if (cmd === 'image') { pickImage(); return; }
    if (cmd === 'bullets') {
      const list = closest('li')?.parentElement;
      if (list?.classList.contains('check')) list.removeAttribute('class');
      else exec('insertUnorderedList');
    } else if (cmd === 'checklist') {
      const list = closest('li')?.parentElement;
      if (list?.tagName === 'UL' && list.classList.contains('check')) exec('insertUnorderedList');
      else if (list?.tagName === 'UL') list.className = 'check';
      else {
        exec('insertUnorderedList');
        const made = closest('li')?.parentElement;
        if (made?.tagName === 'UL') made.className = 'check';
      }
    } else {
      exec(cmd);
    }
    emit();
    refreshTools();
  }

  // 붙여넣은 HTML에 크롬이 덧붙이는 인라인 스타일을 걷어내. 커서 위치는 표시를 박아 두고 되살려.
  function tidy() {
    const s = selection();
    let mark = null;
    if (s.rangeCount && el.contains(s.anchorNode)) {
      mark = document.createElement('i');
      mark.dataset.caret = '';
      const r = s.getRangeAt(0);
      r.collapse(false);
      r.insertNode(mark);
    }
    for (const n of el.querySelectorAll('[style]')) n.removeAttribute('style');
    for (const n of el.querySelectorAll('span, font')) n.replaceWith(...n.childNodes);
    if (mark) {
      const r = document.createRange();
      r.setStartBefore(mark);
      r.collapse(true);
      mark.remove();
      s.removeAllRanges();
      s.addRange(r);
    }
  }

  // ── 사진 ────────────────────────────────────────
  const picker = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  document.body.append(picker);
  let pickRange = null;
  function pickImage() {
    pickRange = saveRange();
    picker.value = '';
    picker.click();
  }
  picker.addEventListener('change', async () => {
    const files = [...picker.files];
    restoreRange(pickRange);
    for (const f of files) await insertImage(f);
  });
  async function insertImage(file) {
    try {
      const url = await imageToDataURL(file);
      if (!el.contains(selection()?.anchorNode)) restoreRange(null);
      document.execCommand('insertImage', false, url);
      emit();
    } catch (err) {
      console.warn('사진을 넣지 못했어', err);
    }
  }

  // ── 체크박스 누르기 ─────────────────────────────
  function checkAt(target, x) {
    const li = target?.closest?.('li');
    if (!li || !el.contains(li) || !li.parentElement?.classList.contains('check')) return null;
    return x - li.getBoundingClientRect().left < 28 ? li : null;
  }
  function toggle(li) {
    if (li.dataset.done === 'true') delete li.dataset.done;
    else li.dataset.done = 'true';
    emit();
  }
  el.addEventListener('mousedown', (e) => {
    const li = checkAt(e.target, e.clientX);
    if (li) { e.preventDefault(); toggle(li); }
  });
  let touch = null;
  el.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    touch = { x: t.clientX, y: t.clientY, li: checkAt(e.target, t.clientX) };
  }, { passive: true });
  el.addEventListener('touchend', (e) => {
    const t = e.changedTouches[0];
    if (touch?.li && Math.hypot(t.clientX - touch.x, t.clientY - touch.y) < 10) {
      e.preventDefault(); // 키보드가 올라오지 않게
      toggle(touch.li);
    }
    touch = null;
  }, { passive: false });

  // ── 입력 ────────────────────────────────────────
  el.addEventListener('input', (e) => {
    if (e.inputType === 'insertParagraph') {
      // 체크된 항목에서 엔터를 치면 새 항목까지 체크된 채로 복제돼서 풀어 줘.
      const li = closest('li');
      for (const x of [li, li?.previousElementSibling]) {
        if (x?.tagName === 'LI' && !x.textContent.trim()) delete x.dataset.done;
      }
    }
    emit();
  });

  el.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && !e.shiftKey && !e.altKey && k === 't') { e.preventDefault(); run('strikeThrough'); }
    else if (mod && e.shiftKey && k === 'l') { e.preventDefault(); run('bullets'); }
    else if (e.key === 'Tab' && !mod) {
      e.preventDefault();
      if (closest('li')) {
        exec(e.shiftKey ? 'outdent' : 'indent');
        for (const ul of el.querySelectorAll('ul.check ul:not(.check)')) ul.className = 'check';
        emit();
      } else if (!e.shiftKey) exec('insertText', '\t');
    }
  });

  el.addEventListener('paste', (e) => {
    const dt = e.clipboardData;
    if (!dt) return;
    const images = [...dt.items]
      .filter(i => i.kind === 'file' && i.type.startsWith('image/'))
      .map(i => i.getAsFile())
      .filter(Boolean);
    e.preventDefault();
    if (images.length) {
      (async () => { for (const f of images) await insertImage(f); })();
      return;
    }
    const html = dt.getData('text/html');
    if (html) {
      const fragment = html.replace(/^[\s\S]*<!--StartFragment-->/, '').replace(/<!--EndFragment-->[\s\S]*$/, '');
      document.execCommand('insertHTML', false, sanitize(fragment));
      tidy();
    } else {
      document.execCommand('insertText', false, dt.getData('text/plain'));
    }
    emit();
  });

  el.addEventListener('dragover', (e) => {
    if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault();
  });
  el.addEventListener('drop', async (e) => {
    const files = [...(e.dataTransfer?.files || [])].filter(f => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    const at = document.caretRangeFromPoint?.(e.clientX, e.clientY);
    restoreRange(at && el.contains(at.startContainer) ? at : null);
    for (const f of files) await insertImage(f);
  });

  // ── 도구 막대 ───────────────────────────────────
  function refreshTools() {
    if (!tools) return;
    const inside = !!currentNode();
    for (const b of tools.querySelectorAll('[data-cmd]')) {
      const c = b.dataset.cmd;
      let on = false;
      if (inside) {
        if (c === 'bullets') {
          const list = closest('li')?.parentElement;
          on = list?.tagName === 'UL' && !list.classList.contains('check');
        } else if (c === 'checklist') on = !!closest('ul.check');
        else if (c !== 'image') { try { on = document.queryCommandState(c); } catch { on = false; } }
      }
      b.classList.toggle('on', !!on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  if (tools) {
    tools.innerHTML = TOOLS.map(t =>
      `<button type="button" class="tool" data-cmd="${t.cmd}" title="${t.title}${t.key ? ` (${MOD}${t.key})` : ''}" aria-label="${t.title}">` +
      (t.icon ? icon(t.icon) : `<span class="glyph glyph-${t.cmd}">${t.label}</span>`) + '</button>').join('');
    for (const b of tools.querySelectorAll('[data-cmd]')) {
      b.addEventListener('mousedown', e => e.preventDefault());
      b.addEventListener('touchend', e => { e.preventDefault(); run(b.dataset.cmd); });
      b.addEventListener('click', () => run(b.dataset.cmd));
    }
    document.addEventListener('selectionchange', refreshTools);
  }

  return {
    el,
    run,
    get: () => el.innerHTML,
    set(html) {
      el.innerHTML = sanitize(html);
      refreshEmpty();
      refreshTools();
    },
    focusEnd() { restoreRange(null); },
    isBlank: blank,
  };
}
