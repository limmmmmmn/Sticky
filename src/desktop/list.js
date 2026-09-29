// 메모 목록 창. 동기화도 여기서 돌아 (창을 닫아도 숨겨질 뿐이라 계속 동작해).
import './list.css';
import { hydrateIcons, icon } from '../shared/icons.js';
import { COLORS } from '../shared/colors.js';
import { sanitize, sortNotes, when, matches, isBlank } from '../shared/notes.js';
import { loadSync } from '../shared/sync-loader.js';
import { mountAccount, statusLine } from '../shared/account.js';

const api = window.sticky;
const $ = s => document.querySelector(s);
const IS_MAC = api.platform === 'darwin';
const MOD = IS_MAC ? '⌘' : 'Ctrl+';

document.body.dataset.platform = api.platform;
hydrateIcons();

const notes = new Map((await api.all()).map(n => [n.id, n]));
const listEl = $('#list');
const emptyEl = $('#empty');
const cards = new Map();
let query = '';

// ── 카드 그리기 ─────────────────────────────────
function cardFor(n) {
  let el = cards.get(n.id);
  if (!el) {
    el = document.createElement('article');
    el.className = 'card';
    el.dataset.id = n.id;
    el.tabIndex = 0;
    el.innerHTML = `<div class="card-top"><time></time><button class="card-more" aria-label="메뉴" aria-expanded="false">${icon('more')}</button></div>
      <div class="card-body editor" data-placeholder="빈 메모"></div>`;
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
  const all = sortNotes([...notes.values()]);
  const visible = all.filter(n => matches(n, query));
  const keep = new Set(visible.map(n => n.id));
  for (const [id, el] of cards) {
    if (keep.has(id)) continue;
    el.remove();
    if (!notes.get(id) || notes.get(id).deleted) cards.delete(id);
  }
  let prev = null;
  for (const n of visible) {
    const el = cardFor(n);
    const want = prev ? prev.nextSibling : listEl.firstChild;
    if (el !== want) listEl.insertBefore(el, want);
    prev = el;
  }
  emptyEl.hidden = visible.length > 0;
  listEl.hidden = visible.length === 0;
  if (!visible.length) {
    emptyEl.innerHTML = all.length
      ? `<p><b>검색 결과가 없어요</b></p><p>“${query.replace(/[<>&]/g, '')}”이(가) 들어간 메모가 없어요.</p>`
      : `<div class="big">${icon('compose')}</div><p><b>메모가 없어요</b></p><p>떠오르는 걸 바로 붙여 두세요.</p>
         <button class="btn primary" data-act="new">새 메모 만들기</button>`;
  }
}
draw();

// 날짜 표시("오후 3:12" → "어제")는 시간이 지나면 바뀌니까 1분마다 다시 써
setInterval(() => {
  for (const t of listEl.querySelectorAll('time[data-ts]')) t.textContent = when(Number(t.dataset.ts));
}, 60_000);

api.onChange((n) => {
  notes.set(n.id, n);
  if (pop.dataset.id === n.id && n.deleted) closePop();
  render();
});

// ── 조작 ────────────────────────────────────────
$('#new').addEventListener('click', () => api.create());
$('#search').addEventListener('input', (e) => { query = e.target.value.trim(); render(); });
for (const b of document.querySelectorAll('[data-act=min]')) b.addEventListener('click', () => api.minimize());
for (const b of document.querySelectorAll('[data-act=hide]')) b.addEventListener('click', () => api.close());
emptyEl.addEventListener('click', (e) => { if (e.target.closest('[data-act=new]')) api.create(); });

listEl.addEventListener('click', (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  const more = e.target.closest('.card-more');
  if (more) {
    const r = more.getBoundingClientRect();
    openPop(card.dataset.id, r.right, r.bottom + 4, more);
  } else {
    api.open(card.dataset.id);
  }
});
listEl.addEventListener('contextmenu', (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  e.preventDefault();
  openPop(card.dataset.id, e.clientX + 230, e.clientY);
});
listEl.addEventListener('keydown', (e) => {
  const card = e.target.closest('.card');
  if (card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); api.open(card.dataset.id); }
});

// ── 카드 메뉴 ───────────────────────────────────
const pop = $('#pop');
let popAnchor = null;

function openPop(id, right, top, anchor = null) {
  const n = notes.get(id);
  if (!n) return;
  closePop();
  pop.dataset.id = id;
  popAnchor = anchor;
  anchor?.setAttribute('aria-expanded', 'true');
  pop.innerHTML = `
    <div class="swatches">${COLORS.map(c => `<button class="swatch" data-color="${c.id}" title="${c.name}" aria-label="${c.name}" aria-checked="${c.id === n.color}"></button>`).join('')}</div>
    <div class="sep"></div>
    <button class="item" data-act="open"><span>${icon('open')}</span>메모 열기</button>
    <button class="item danger" data-act="delete"><span>${icon('trash')}</span>메모 삭제</button>`;
  pop.hidden = false;
  const w = pop.offsetWidth;
  const h = pop.offsetHeight;
  pop.style.left = `${Math.max(8, Math.min(right - w, innerWidth - w - 8))}px`;
  pop.style.top = `${Math.max(8, Math.min(top, innerHeight - h - 8))}px`;
}

function closePop() {
  pop.hidden = true;
  delete pop.dataset.id;
  popAnchor?.setAttribute('aria-expanded', 'false');
  popAnchor = null;
}

pop.addEventListener('click', (e) => {
  const id = pop.dataset.id;
  const sw = e.target.closest('.swatch');
  if (sw) {
    api.update(id, { color: sw.dataset.color });
    for (const s of pop.querySelectorAll('.swatch')) s.setAttribute('aria-checked', s === sw ? 'true' : 'false');
    return;
  }
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'open') { closePop(); api.open(id); }
  else if (act === 'delete') {
    if (isBlank(notes.get(id)?.html)) { closePop(); api.remove(id); return; }
    pop.innerHTML = `<p class="ask">이 메모를 삭제할까요?</p>
      <div class="ask-row"><button data-act="cancel">취소</button><button class="danger" data-act="really">삭제</button></div>`;
  } else if (act === 'cancel') closePop();
  else if (act === 'really') { closePop(); api.remove(id); }
});
document.addEventListener('mousedown', (e) => {
  if (!pop.hidden && !pop.contains(e.target) && !e.target.closest('.card-more')) closePop();
});
window.addEventListener('blur', closePop);

// ── 설정 ────────────────────────────────────────
const settingsEl = $('#settings');
const openSettings = () => { closePop(); settingsEl.hidden = false; };
const closeSettings = () => { settingsEl.hidden = true; };
$('#settingsBtn').addEventListener('click', openSettings);
$('#back').addEventListener('click', closeSettings);
$('#syncbar').addEventListener('click', openSettings);

const autostart = $('#autostart');
function showSettings(s) {
  autostart.checked = !!s.openAtLogin;
  autostart.disabled = !s.packaged;
  const note = $('#autostartNote');
  note.hidden = s.packaged;
  note.textContent = '설치한 앱에서만 바꿀 수 있어요';
  $('#about').innerHTML = `Sticky ${s.version}<br>윈도우 · 맥 · 아이폰 스티커 메모`;
}
showSettings(await api.settings());
api.onSettings(showSettings);
autostart.addEventListener('change', () => api.setSetting('openAtLogin', autostart.checked));

const KEYS = [
  ['새 메모', `${MOD}N`],
  ['어디서나 새 메모', IS_MAC ? '⌘⌥N' : 'Ctrl+Alt+N'],
  ['메모 닫기', `${MOD}W`],
  ['메모 삭제', `${MOD}D`],
  ['굵게 · 기울임 · 밑줄', `${MOD}B · I · U`],
  ['취소선', `${MOD}T`],
  ['글머리 기호', IS_MAC ? '⌘⇧L' : 'Ctrl+Shift+L'],
];
$('#keys').innerHTML = KEYS.map(([a, b]) => `<div class="row"><span>${a}</span><kbd>${b}</kbd></div>`).join('');

// ── 단축키 ──────────────────────────────────────
document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (e.key === 'Escape') {
    if (!pop.hidden) closePop();
    else if (!settingsEl.hidden) closeSettings();
    else if (query) { $('#search').value = ''; query = ''; render(); }
  } else if (!IS_MAC && mod && !e.shiftKey && k === 'n') { e.preventDefault(); api.create(); }
  else if (mod && k === 'f') { e.preventDefault(); closeSettings(); $('#search').focus(); }
});

// ── 동기화 ──────────────────────────────────────
const store = {
  all: () => api.all(),
  applyRemote: list => api.applyRemote(list),
  onLocalChange: cb => api.onChange((n, meta) => { if (!meta.remote) cb(n); }),
};
const sync = await loadSync(store);
const bar = $('#syncbar');
sync.onStatus((s) => {
  const line = statusLine(s);
  bar.innerHTML = `${icon(line.icon)}<span>${line.text}</span>`;
  bar.dataset.tone = line.bad ? 'bad' : line.ok ? 'ok' : '';
});
mountAccount($('#account'), sync);

// 맥은 자동 업데이트가 안 돼서 새 버전이 나오면 알려 줘
const update = await api.checkUpdate();
if (update) {
  const box = $('#update');
  box.innerHTML = `<b>새 버전 ${update.version}이 나왔어요</b><button>받기</button>`;
  box.hidden = false;
  box.querySelector('button').addEventListener('click', () => api.openExternal(update.url));
}
