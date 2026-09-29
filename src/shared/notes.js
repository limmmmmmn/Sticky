// 메모 데이터 도우미. 메모 한 장은 이렇게 생겼어:
// { id, html, color, created, updated, deleted }
// deleted는 동기화용 흔적(툼스톤)이라 삭제해도 한동안 남아 있어.
import { DEFAULT_COLOR, isColor } from './colors.js';

const KEEP = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'BR', 'DIV', 'P', 'UL', 'OL', 'LI', 'IMG']);
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'NOSCRIPT', 'SVG', 'MATH', 'HEAD',
  'TITLE', 'META', 'LINK', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'CANVAS', 'VIDEO', 'AUDIO', 'FORM']);
// 다른 태그지만 줄 바꿈은 살려야 하는 블록들
const BLOCKY = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'BLOCKQUOTE',
  'PRE', 'TR', 'TABLE', 'ASIDE', 'NAV', 'MAIN', 'FIGURE', 'DT', 'DD', 'ADDRESS']);
const IMG_SRC = /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i;

function parse(html) {
  return new DOMParser().parseFromString(`<!doctype html><body>${html || ''}`, 'text/html').body;
}

function clean(node) {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === 3) continue;
    if (child.nodeType !== 1) { child.remove(); continue; }
    const tag = child.tagName.toUpperCase();
    if (DROP.has(tag)) { child.remove(); continue; }
    clean(child);
    const style = child.getAttribute('style') || '';
    // 구글 문서는 전체를 <b style="font-weight:normal">로 감싸서 붙여넣어. 그대로 두면 다 굵어져.
    if ((tag === 'B' || tag === 'STRONG') && /font-weight:\s*(normal|[1-5]00)\b/i.test(style)) {
      child.replaceWith(...child.childNodes);
      continue;
    }
    // 스타일로만 표현된 서식(구글 문서, 노션 등)은 태그로 바꿔서 살려.
    if (tag === 'SPAN' && style) {
      let inner = [...child.childNodes];
      const wrap = (t) => { const w = child.ownerDocument.createElement(t); w.append(...inner); inner = [w]; };
      if (/font-weight:\s*(bold|[6-9]00)\b/i.test(style)) wrap('b');
      if (/font-style:\s*italic/i.test(style)) wrap('i');
      if (/text-decoration[^;]*underline/i.test(style)) wrap('u');
      if (/text-decoration[^;]*line-through/i.test(style)) wrap('s');
      child.replaceWith(...inner);
      continue;
    }
    if (!KEEP.has(tag)) {
      if (BLOCKY.has(tag)) {
        const div = child.ownerDocument.createElement('div');
        div.append(...child.childNodes);
        child.replaceWith(div);
      } else {
        child.replaceWith(...child.childNodes);
      }
      continue;
    }
    for (const { name, value } of [...child.attributes]) {
      const keep = (tag === 'IMG' && name === 'src' && IMG_SRC.test(value))
        || (tag === 'LI' && name === 'data-done' && value === 'true')
        || (tag === 'UL' && name === 'class' && value === 'check');
      if (!keep) child.removeAttribute(name);
    }
    if (tag === 'IMG' && !child.hasAttribute('src')) child.remove();
  }
}

// 붙여넣기나 다른 기기에서 온 HTML을 메모에 허용된 서식만 남기고 정리해.
export function sanitize(html) {
  const body = parse(html);
  clean(body);
  return body.innerHTML;
}

// 목록 미리보기·창 제목·검색에 쓰는 순수 텍스트
export function toText(html) {
  const body = parse(html);
  let out = '';
  const walk = (n) => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) { out += c.nodeValue; continue; }
      if (c.nodeType !== 1) continue;
      const t = c.tagName;
      if (t === 'BR') { out += '\n'; continue; }
      if (t === 'IMG') { out += '[사진] '; continue; }
      const block = t === 'DIV' || t === 'P' || t === 'LI' || t === 'UL' || t === 'OL';
      if (block && out && !out.endsWith('\n')) out += '\n';
      if (t === 'LI') out += c.parentElement?.classList.contains('check') ? (c.dataset.done === 'true' ? '☑ ' : '☐ ') : '• ';
      walk(c);
      if (block && out && !out.endsWith('\n')) out += '\n';
    }
  };
  walk(body);
  return out.replace(/ /g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

export function isBlank(html) {
  return !/<img/i.test(html || '') && toText(html).trim() === '';
}

export function firstLine(html, max = 40) {
  const line = toText(html).split('\n').find(l => l.trim()) || '';
  return line.length > max ? line.slice(0, max) + '…' : line;
}

export function newId() {
  const a = crypto.getRandomValues(new Uint8Array(10));
  return 'n' + Date.now().toString(36) + [...a].map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 12);
}

export function makeNote({ color = DEFAULT_COLOR, html = '' } = {}) {
  const now = Date.now();
  return { id: newId(), html, color: isColor(color) ? color : DEFAULT_COLOR, created: now, updated: now, deleted: false };
}

// 원격에서 온 값을 믿지 않고 모양을 맞춰.
export function normalize(n) {
  return {
    id: String(n.id),
    html: n.deleted ? '' : String(n.html || ''),
    color: isColor(n.color) ? n.color : DEFAULT_COLOR,
    created: Number(n.created) || Number(n.updated) || Date.now(),
    updated: Number(n.updated) || 0,
    deleted: !!n.deleted,
  };
}

// 나중에 수정된 쪽이 이겨 (last-write-wins)
export function isNewer(incoming, current) {
  return !current || incoming.updated > current.updated;
}

export const TOMBSTONE_TTL = 30 * 24 * 3600 * 1000;

export function sortNotes(list) {
  return list.filter(n => !n.deleted).sort((a, b) => b.updated - a.updated);
}

const timeFmt = new Intl.DateTimeFormat('ko-KR', { hour: 'numeric', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric' });
const yearFmt = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric' });

export function when(ts) {
  const d = new Date(ts);
  const now = new Date();
  const startOfDay = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (days === 0) return timeFmt.format(d);
  if (days === 1) return '어제';
  if (d.getFullYear() === now.getFullYear()) return dayFmt.format(d);
  return yearFmt.format(d);
}

export function matches(note, query) {
  if (!query) return true;
  return toText(note.html).toLowerCase().includes(query.toLowerCase());
}
