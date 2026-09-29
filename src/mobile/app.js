// 아이폰 웹앱: 메모 목록(정사각형 카드) + 전체 화면 편집
import './mobile.css';
import { createLocalStore } from './store.js';
import { createEditor } from '../shared/editor.js';
import { COLORS } from '../shared/colors.js';
import { hydrateIcons, icon } from '../shared/icons.js';
import { sanitize, sortNotes, matches, isBlank, when } from '../shared/notes.js';
import { loadSync } from '../shared/sync-loader.js';
import { mountAccount, statusLine } from '../shared/account.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 사생활 보호 모드 */ } },
};

hydrateIcons();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

const store = await createLocalStore();
const grid = $('#grid');
const emptyEl = $('#empty');
const scroller = $('#scroller');
const view = $('#editorView');
const layer = $('#layer');
const cards = new Map();
let query = '';
let sync = null;

// ── 목록 ────────────────────────────────────────
function cardFor(n) {
  let el = cards.get(n.id);
  if (!el) {
    el = document.createElement('article');
    el.className = 'card';
    el.dataset.id = n.id;
    el.innerHTML = '<div class="card-body editor" data-placeholder="빈 메모"></div><time></time>';
    cards.set(n.id, el);
  }
  if (el.dataset.v !== String(n.updated)) {
    el.dataset.v = String(n.updated);
    el.dataset.color = n.color;
    const body = el.querySelector('.card-body');
    body.innerHTML = sanitize(n.html);
    body.classList.toggle('is-empty', isBlank(n.html));
    const t = el.querySelector('time');
    t.dataset.ts = String(n.updated);
    t.textContent = when(n.updated);
  }
  return el;
}

let frame = 0;
const render = () => { if (!frame) frame = requestAnimationFrame(draw); };
function draw() {
  frame = 0;
  const all = sortNotes(store.all());
  const visible = all.filter(n => matches(n, query));
  const keep = new Set(visible.map(n => n.id));
  for (const [id, el] of cards) {
    if (keep.has(id)) continue;
    el.remove();
    if (!store.get(id) || store.get(id).deleted) cards.delete(id);
  }
  let prev = null;
  for (const n of visible) {
    const el = cardFor(n);
    const want = prev ? prev.nextSibling : grid.firstChild;
    if (el !== want) grid.insertBefore(el, want);
    prev = el;
  }
  $('#count').textContent = all.length ? `메모 ${all.length}개` : '';
  emptyEl.hidden = visible.length > 0;
  if (!visible.length) {
    emptyEl.innerHTML = all.length
      ? `<b>검색 결과 없음</b><p>“${esc(query)}”이(가) 들어간 메모가 없어요.</p>`
      : `<div class="big">${icon('compose')}</div><b>메모가 없어요</b><p>오른쪽 아래 버튼을 눌러<br>첫 메모를 붙여 보세요.</p>`;
  }
}
draw();
setInterval(() => { for (const t of grid.querySelectorAll('time[data-ts]')) t.textContent = when(Number(t.dataset.ts)); }, 60_000);

scroller.addEventListener('scroll', () => $('#nav').classList.toggle('scrolled', scroller.scrollTop > 34), { passive: true });
$('#search').addEventListener('input', (e) => { query = e.target.value.trim(); render(); });
$('#search').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });

// 홈 화면에 추가 안내 (사파리에서 열었을 때만)
const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
if (!standalone && isIOS && !ls.get('sticky-install-hidden')) $('#install').hidden = false;
$('#installX').addEventListener('click', () => { $('#install').hidden = true; ls.set('sticky-install-hidden', '1'); });

// 카드: 누르면 열기, 꾹 누르면 메뉴
let press = null;
grid.addEventListener('touchstart', (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  const t = e.touches[0];
  card.classList.add('pressed');
  press = { card, x: t.clientX, y: t.clientY, fired: false };
  press.timer = setTimeout(() => {
    press.fired = true;
    card.classList.remove('pressed');
    navigator.vibrate?.(8);
    cardMenu(card.dataset.id);
  }, 480);
}, { passive: true });
grid.addEventListener('touchmove', (e) => {
  if (!press) return;
  const t = e.touches[0];
  if (Math.hypot(t.clientX - press.x, t.clientY - press.y) > 8) cancelPress();
}, { passive: true });
grid.addEventListener('touchend', (e) => {
  if (press?.fired) e.preventDefault(); // 메뉴가 떴으면 열지 않기
  cancelPress();
});
grid.addEventListener('touchcancel', cancelPress);
function cancelPress() {
  if (!press) return;
  clearTimeout(press.timer);
  press.card.classList.remove('pressed');
  press = null;
}
grid.addEventListener('click', (e) => {
  const card = e.target.closest('.card');
  if (card) openNote(card.dataset.id);
});
grid.addEventListener('contextmenu', (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  e.preventDefault();
  if (!press) cardMenu(card.dataset.id);
});

async function cardMenu(id) {
  const n = store.get(id);
  if (!n) return;
  const pick = await actionSheet({
    color: n.color,
    onColor: c => store.update(id, { color: c }),
    actions: [{ label: '열기' }, { label: '메모 삭제', danger: true }],
  });
  if (pick === 0) openNote(id);
  else if (pick === 1) deleteNote(id);
}

$('#compose').addEventListener('click', () => {
  const n = store.create({});
  openNote(n.id, { fresh: true });
});

// ── 편집 ────────────────────────────────────────
let current = null;
let pending = null;
let timer = null;
const colorsEl = $('#colors');
const themeMetas = [...document.querySelectorAll('meta[name="theme-color"]')];
const fullDate = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });

const ed = createEditor($('#editor'), {
  tools: $('#tools'),
  onChange(html) {
    pending = html;
    clearTimeout(timer);
    timer = setTimeout(save, 400);
  },
});

function save() {
  clearTimeout(timer);
  timer = null;
  if (pending == null || !current) return;
  const n = store.update(current, { html: pending });
  pending = null;
  if (n) $('#edDate').textContent = fullDate.format(n.updated);
}

colorsEl.innerHTML = COLORS.map(c => `<button class="swatch" data-color="${c.id}" aria-label="${c.name}"></button>`).join('');
function paintColor(c) {
  view.dataset.color = c;
  for (const s of colorsEl.children) s.setAttribute('aria-checked', s.dataset.color === c ? 'true' : 'false');
  const bar = getComputedStyle(view).getPropertyValue('--bar').trim();
  for (const m of themeMetas) m.content = bar;
}
function resetTheme() {
  themeMetas[0].content = '#FFFFFF';
  themeMetas[1].content = '#000000';
}

function openNote(id, { fresh = false } = {}) {
  const n = store.get(id);
  if (!n || n.deleted) return;
  current = id;
  pending = null;
  ed.set(n.html);
  paintColor(n.color);
  colorsEl.hidden = true;
  $('#edDate').textContent = fullDate.format(n.updated);
  view.classList.remove('fade', 'enter');
  if (fresh) {
    view.hidden = false;
    view.classList.add('fade');
    ed.focusEnd(); // 사용자가 누른 순간 바로 불러야 키보드가 올라와
  } else {
    view.classList.add('enter');
    view.hidden = false;
    view.getBoundingClientRect();
    view.classList.remove('enter');
  }
  $('#edScroll').scrollTop = 0;
}

function closeNote() {
  if (!current) return;
  save();
  const id = current;
  current = null;
  ed.el.blur();
  const n = store.get(id);
  if (n && !n.deleted && isBlank(n.html)) store.remove(id); // 빈 메모는 조용히 버려
  view.classList.remove('fade');
  view.classList.add('enter');
  resetTheme();
  setTimeout(() => { if (!current) { view.hidden = true; view.classList.remove('enter'); } }, 380);
  sync?.flush();
}

function deleteNote(id) {
  if (id === current) { pending = null; clearTimeout(timer); }
  const prev = store.remove(id);
  if (id === current) closeNote();
  if (prev && !isBlank(prev.html)) toast('메모를 삭제했어요', { label: '실행 취소', run: () => store.restore(prev) });
}

$('#back').addEventListener('click', closeNote);
$('#colorBtn').addEventListener('click', () => { colorsEl.hidden = !colorsEl.hidden; });
colorsEl.addEventListener('click', (e) => {
  const c = e.target.closest('.swatch')?.dataset.color;
  if (!c || !current) return;
  paintColor(c);
  store.update(current, { color: c });
});
$('#moreBtn').addEventListener('click', async () => {
  const id = current;
  const pick = await actionSheet({ actions: [{ label: '메모 삭제', danger: true }] });
  if (pick === 0 && id) deleteNote(id);
});
$('#done').addEventListener('click', () => ed.el.blur());
$('#edScroll').addEventListener('click', (e) => { if (e.target.id === 'edScroll' || e.target.id === 'edDate') ed.focusEnd(); });
ed.el.addEventListener('focus', () => { view.classList.add('typing'); colorsEl.hidden = true; });
ed.el.addEventListener('blur', () => { view.classList.remove('typing'); save(); });

// 키보드가 올라오면 화면을 보이는 영역에 맞춰서, 서식 막대가 키보드 바로 위에 붙게 해
const vv = window.visualViewport;
function fit() {
  if (!vv) return;
  for (const el of [view, layer]) {
    el.style.height = `${vv.height}px`;
    el.style.top = `${vv.offsetTop}px`;
  }
}
vv?.addEventListener('resize', fit);
vv?.addEventListener('scroll', fit);
fit();

// 왼쪽 끝에서 밀면 뒤로 가기
let swipe = null;
view.addEventListener('touchstart', (e) => {
  const t = e.touches[0];
  swipe = t.clientX < 24 ? { x: t.clientX, y: t.clientY, dx: 0, on: false } : null;
}, { passive: true });
view.addEventListener('touchmove', (e) => {
  if (!swipe) return;
  const t = e.touches[0];
  const dx = t.clientX - swipe.x;
  const dy = t.clientY - swipe.y;
  if (!swipe.on) {
    if (Math.abs(dy) > 10 && Math.abs(dy) > dx) { swipe = null; return; }
    if (dx > 10) { swipe.on = true; view.style.transition = 'none'; }
  }
  if (swipe.on) {
    e.preventDefault();
    swipe.dx = Math.max(0, dx);
    view.style.transform = `translateX(${swipe.dx}px)`;
  }
}, { passive: false });
view.addEventListener('touchend', () => {
  if (!swipe) return;
  const go = swipe.on && swipe.dx > innerWidth / 3;
  view.style.transition = '';
  view.style.transform = '';
  if (go) closeNote();
  swipe = null;
});

// 다른 기기에서 바뀐 내용
store.onChange((n, meta) => {
  render();
  if (n.id !== current || !meta.remote) return;
  if (n.deleted) {
    current = null;
    pending = null;
    ed.el.blur();
    view.hidden = true;
    resetTheme();
    toast('다른 기기에서 삭제된 메모예요');
    return;
  }
  paintColor(n.color);
  if (pending == null && n.html !== ed.get()) ed.set(n.html);
  $('#edDate').textContent = fullDate.format(n.updated);
});

// 앱을 내리면 바로 저장·업로드
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { save(); sync?.flush(); }
});
window.addEventListener('pagehide', save);

// ── 액션 시트·시트·토스트 ───────────────────────
function showLayer(html) {
  layer.innerHTML = html;
  layer.classList.remove('closing');
  layer.hidden = false;
}
function hideLayer() {
  layer.classList.add('closing');
  setTimeout(() => { layer.hidden = true; layer.classList.remove('closing'); layer.innerHTML = ''; }, 220);
}

function actionSheet({ color, onColor, actions }) {
  return new Promise((resolve) => {
    const row = color
      ? `<div class="swatch-row">${COLORS.map(c => `<button class="swatch" data-color="${c.id}" aria-label="${c.name}" aria-checked="${c.id === color}"></button>`).join('')}</div>`
      : '';
    showLayer(`<div class="actions">
      <div class="grp">${row}${actions.map((a, i) => `<button class="act${a.danger ? ' danger' : ''}" data-i="${i}">${a.label}</button>`).join('')}</div>
      <div class="grp"><button class="act cancel" data-i="-1">취소</button></div></div>`);
    layer.onclick = (e) => {
      const sw = e.target.closest('.swatch');
      if (sw) { onColor?.(sw.dataset.color); hideLayer(); resolve(-1); return; }
      const b = e.target.closest('[data-i]');
      if (b || e.target === layer) { hideLayer(); resolve(b ? Number(b.dataset.i) : -1); }
    };
  });
}

function openSheet(title, fill) {
  showLayer(`<div class="sheet" role="dialog" aria-label="${title}"><div class="sheet-head"><span class="grabber"></span><h2>${title}</h2><button class="sheet-done">완료</button></div><div class="sheet-body"></div></div>`);
  const cleanup = fill(layer.querySelector('.sheet-body'));
  layer.onclick = (e) => {
    if (e.target === layer || e.target.closest('.sheet-done')) {
      document.activeElement?.blur?.();
      cleanup?.();
      hideLayer();
    }
  };
}

const toastEl = $('#toast');
let toastTimer = null;
function toast(text, action) {
  toastEl.innerHTML = `<span>${esc(text)}</span>${action ? `<button>${esc(action.label)}</button>` : ''}`;
  toastEl.hidden = false;
  toastEl.style.animation = 'none';
  toastEl.getBoundingClientRect();
  toastEl.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 4000);
  toastEl.querySelector('button')?.addEventListener('click', () => { toastEl.hidden = true; action.run(); });
}

// ── 동기화 ──────────────────────────────────────
const syncBtn = $('#syncBtn');
syncBtn.innerHTML = icon('cloud');
syncBtn.addEventListener('click', () => sync && openSheet('동기화', (body) => {
  const box = document.createElement('div');
  body.append(box);
  const off = mountAccount(box, sync);
  body.insertAdjacentHTML('beforeend', `
    <p class="sheet-sec">정보</p>
    <div class="group sheet-info">
      <div class="row"><div class="row-main"><div class="row-title">버전</div></div><span class="row-sub">${__VERSION__}</span></div>
      <div class="row"><div class="row-main"><div class="row-title">윈도우·맥 앱</div></div><a class="row-sub" href="https://github.com/limmmmmmn/Sticky/releases/latest" target="_blank" rel="noopener">받으러 가기</a></div>
    </div>`);
  return off;
}));

sync = await loadSync(store);
sync.onStatus((s) => {
  const line = statusLine(s);
  syncBtn.innerHTML = icon(line.icon);
  syncBtn.dataset.tone = line.bad ? 'bad' : line.ok ? 'ok' : (s.state === 'unconfigured' || s.state === 'signedOut') ? 'off' : '';
  syncBtn.setAttribute('aria-label', `동기화: ${line.text}`);
});
