// 메모 창 하나
import './note.css';
import { createEditor } from '../shared/editor.js';
import { COLORS } from '../shared/colors.js';
import { hydrateIcons, icon } from '../shared/icons.js';
import { firstLine } from '../shared/notes.js';

const api = window.sticky;
const $ = s => document.querySelector(s);
const id = new URLSearchParams(location.search).get('id');
const IS_MAC = api.platform === 'darwin';

document.body.dataset.platform = api.platform;
hydrateIcons();

const note = await api.get(id);
if (!note || note.deleted) api.close();

let color = note?.color || 'yellow';
let pending = null;
let timer = null;

// ── 색 ──────────────────────────────────────────
const swatches = $('#swatches');
swatches.innerHTML = COLORS.map(c =>
  `<button class="swatch" data-color="${c.id}" role="radio" title="${c.name}" aria-label="${c.name}"></button>`).join('');
function setColor(c) {
  color = c;
  document.documentElement.dataset.color = c;
  for (const s of swatches.children) s.setAttribute('aria-checked', s.dataset.color === c ? 'true' : 'false');
}
setColor(color);
swatches.addEventListener('click', (e) => {
  const c = e.target.closest('.swatch')?.dataset.color;
  if (!c || c === color) return;
  setColor(c);
  api.update(id, { color: c });
});

// ── 본문 ────────────────────────────────────────
const ed = createEditor($('#editor'), {
  tools: $('#tools'),
  onChange(html) {
    pending = html;
    clearTimeout(timer);
    timer = setTimeout(save, 250);
    document.title = firstLine(html) || '메모';
  },
});
ed.set(note?.html || '');
document.title = firstLine(note?.html || '') || '메모';
if (ed.isBlank()) ed.focusEnd();

// 여백(글 왼쪽·위·아래)을 누르거나 끌어도 가장 가까운 글자부터 커서·선택이 시작되게
$('#scroll').addEventListener('mousedown', (e) => {
  if (e.button !== 0 || ed.el.contains(e.target)) return;
  ed.dragSelect(e);
});

function save() {
  clearTimeout(timer);
  timer = null;
  if (pending == null) return;
  const html = pending;
  pending = null;
  api.update(id, { html });
}
function saveNow() {
  clearTimeout(timer);
  timer = null;
  if (pending == null) return;
  api.updateNow(id, { html: pending });
  pending = null;
}
window.addEventListener('beforeunload', saveNow);
window.addEventListener('blur', save);

// 다른 기기(동기화)나 목록 창에서 바뀐 내용 받기
api.onChange((n, meta) => {
  if (n.id !== id || meta.self || n.deleted) return;
  if (n.color !== color) setColor(n.color);
  if (pending == null && n.html !== ed.get()) {
    const keep = document.activeElement === ed.el ? caretOffset() : -1;
    ed.set(n.html);
    if (keep >= 0) setCaret(keep);
    document.title = firstLine(n.html) || '메모';
  }
});

function caretOffset() {
  const s = getSelection();
  if (!s.rangeCount || !ed.el.contains(s.anchorNode)) return -1;
  const r = document.createRange();
  r.selectNodeContents(ed.el);
  r.setEnd(s.anchorNode, s.anchorOffset);
  return r.toString().length;
}
function setCaret(offset) {
  const walk = document.createTreeWalker(ed.el, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (offset <= n.length) {
      const r = document.createRange();
      r.setStart(n, offset);
      r.collapse(true);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      return;
    }
    offset -= n.length;
  }
  ed.focusEnd();
}

// ── 활성 상태: 버튼·서식 막대는 활성일 때만 ──────
const setActive = on => document.body.classList.toggle('active', on);
window.addEventListener('focus', () => setActive(true));
window.addEventListener('blur', () => { setActive(false); closeMenu(); });
setActive(document.hasFocus());

// ── 항상 위 ─────────────────────────────────────
const pin = $('#pin');
function showPin(on) {
  pin.setAttribute('aria-pressed', on ? 'true' : 'false');
  pin.innerHTML = icon(on ? 'pinFill' : 'pin');
  pin.title = on ? '항상 위에 두기 끄기' : '항상 위에 두기';
}
showPin(await api.isTop());
pin.addEventListener('click', async () => showPin(await api.setTop(pin.getAttribute('aria-pressed') !== 'true')));

// ── 버튼들 ──────────────────────────────────────
$('#new').addEventListener('click', () => api.create());
$('#close').addEventListener('click', closeNote);
$('#openList').addEventListener('click', () => { closeMenu(); api.showList(); });
$('#delete').addEventListener('click', () => { closeMenu(); askDelete(); });

function closeNote() {
  saveNow();
  if (ed.isBlank()) api.remove(id);
  else api.close();
}

const menu = $('#menu');
const more = $('#more');
function closeMenu() {
  menu.hidden = true;
  more.setAttribute('aria-expanded', 'false');
}
more.addEventListener('click', () => {
  const open = menu.hidden;
  menu.hidden = !open;
  more.setAttribute('aria-expanded', open ? 'true' : 'false');
});
document.addEventListener('mousedown', (e) => {
  if (!menu.hidden && !menu.contains(e.target) && !more.contains(e.target)) closeMenu();
});

const confirmBox = $('#confirm');
function askDelete() {
  if (ed.isBlank()) { api.remove(id); return; }
  confirmBox.hidden = false;
  $('#confirmDelete').focus();
}
$('#cancelDelete').addEventListener('click', () => { confirmBox.hidden = true; ed.el.focus(); });
$('#confirmDelete').addEventListener('click', () => { pending = null; api.remove(id); });

// ── 단축키 (맥은 메뉴가 ⌘N·⌘W를 맡아) ───────────
document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (e.key === 'Escape') {
    if (!confirmBox.hidden) { confirmBox.hidden = true; ed.el.focus(); } else closeMenu();
  } else if (!IS_MAC && mod && !e.shiftKey && k === 'n') { e.preventDefault(); api.create(); }
  else if (!IS_MAC && mod && !e.shiftKey && k === 'w') { e.preventDefault(); closeNote(); }
  else if (mod && !e.shiftKey && k === 'd') { e.preventDefault(); askDelete(); }
});

// 파일을 창에 떨어뜨려도 그 파일로 넘어가지 않게 (글자 끌어 옮기기는 그대로)
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
document.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
document.addEventListener('drop', (e) => { if (hasFiles(e)) e.preventDefault(); });
