// Sticky 데스크톱: 메모 한 장이 창 하나. 메모 데이터는 여기(메인 프로세스)가 들고 있고
// 창들은 IPC로 읽고 써. 동기화는 목록 창이 맡아(숨겨져 있어도 계속 돌아).
'use strict';
const {
  app, BrowserWindow, ipcMain, Menu, Tray, screen, nativeTheme, protocol, net, shell, globalShortcut, nativeImage,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const IS_MAC = process.platform === 'darwin';
const ROOT = path.join(__dirname, '..', 'out', 'desktop');
const ASSETS = path.join(__dirname, '..', 'assets');
const REPO = 'limmmmmmn/Sticky';
const TEST = !!process.env.STICKY_DATA; // 테스트 실행: 시작 프로그램 등록·업데이트 확인 안 함
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json',
};

// 개발 중엔 실제 메모와 섞이지 않게 다른 폴더를 써. 테스트는 STICKY_DATA로 따로 지정.
if (process.env.STICKY_DATA) app.setPath('userData', process.env.STICKY_DATA);
else if (!app.isPackaged) app.setPath('userData', path.join(app.getPath('appData'), 'Sticky-dev'));

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

// ── 메모 도우미 (src/shared/notes.js와 같은 규칙) ─────────
const COLORS = ['yellow', 'orange', 'pink', 'purple', 'blue', 'green', 'gray', 'charcoal'];
const PAPER = {
  light: { yellow: '#FFF7C2', orange: '#FFE9D2', pink: '#FFE3EE', purple: '#EFE5FF', blue: '#DFEFFF', green: '#DFF7D8', gray: '#F0F0F3', charcoal: '#3A3A3D' },
  dark: { yellow: '#463C12', orange: '#48300F', pink: '#4A1F31', purple: '#36264F', blue: '#1C3050', green: '#1F3D23', gray: '#2C2C2E', charcoal: '#1C1C1E' },
};
const TOMBSTONE_TTL = 30 * 24 * 3600 * 1000;
const paper = c => (nativeTheme.shouldUseDarkColors ? PAPER.dark : PAPER.light)[c] || PAPER.light.yellow;

function newId() {
  return 'n' + Date.now().toString(36) + crypto.randomBytes(8).toString('hex').slice(0, 12);
}
function makeNote(color, html = '') {
  const now = Date.now();
  return { id: newId(), html, color: COLORS.includes(color) ? color : 'yellow', created: now, updated: now, deleted: false };
}
function normalize(n) {
  return {
    id: String(n.id),
    html: n.deleted ? '' : String(n.html || ''),
    color: COLORS.includes(n.color) ? n.color : 'yellow',
    created: Number(n.created) || Number(n.updated) || Date.now(),
    updated: Number(n.updated) || 0,
    deleted: !!n.deleted,
  };
}
const isNewer = (a, b) => !b || a.updated > b.updated;
function isBlankHtml(html) {
  if (/<img|<li/i.test(html || '')) return false;
  return String(html || '').replace(/<[^>]*>/g, '').replace(/&nbsp;|\s/g, '') === '';
}
function debounce(fn, ms) {
  let t = null;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ── 파일 저장 ─────────────────────────────────────────────
function jsonFile(name, fallback) {
  const file = path.join(app.getPath('userData'), name);
  let data = fallback;
  let existed = false;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); existed = true; } catch { /* 처음 */ }
  let timer = null;
  const write = () => {
    timer = null;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file + '.tmp', JSON.stringify(data));
      fs.renameSync(file + '.tmp', file);
    } catch (err) {
      console.error('저장 실패', file, err);
    }
  };
  return {
    file,
    existed,
    get data() { return data; },
    set data(v) { data = v; },
    save() { if (!timer) timer = setTimeout(write, 400); },
    flush() { if (timer) { clearTimeout(timer); write(); } },
  };
}

let notesFile, stateFile, state;
const notes = new Map();
const noteWins = new Map(); // id → BrowserWindow
let listWin = null;
let tray = null;
let quitting = false;

function saveNotes() {
  notesFile.data = { notes: [...notes.values()] };
  notesFile.save();
}
const saveState = () => stateFile.save();

function loadData() {
  notesFile = jsonFile('notes.json', { notes: [] });
  if (notesFile.existed) {
    // 혹시 모를 일에 대비해 켤 때마다 한 부 복사해 둬.
    try { fs.copyFileSync(notesFile.file, notesFile.file.replace(/\.json$/, '.backup.json')); } catch { /* 없음 */ }
  }
  const now = Date.now();
  for (const raw of notesFile.data.notes || []) {
    const n = normalize(raw);
    if (n.deleted && now - n.updated > TOMBSTONE_TTL) continue;
    notes.set(n.id, n);
  }
  stateFile = jsonFile('state.json', {});
  state = stateFile.data;
  state.windows ||= {};
  state.settings ||= {};
  state.settings.openAtLogin ??= true;
  for (const id of Object.keys(state.windows)) if (!notes.has(id) || notes.get(id).deleted) delete state.windows[id];
  return !notesFile.existed;
}

// ── 창 공통 ───────────────────────────────────────────────
const winIcon = () => path.join(ASSETS, 'build', 'icon-win.png');

function harden(win) {
  const wc = win.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', e => e.preventDefault());
  wc.on('context-menu', (_e, p) => {
    const items = [];
    if (p.isEditable) {
      items.push(
        { role: 'undo', label: '실행 취소', enabled: p.editFlags.canUndo },
        { role: 'redo', label: '다시 실행', enabled: p.editFlags.canRedo },
        { type: 'separator' },
        { role: 'cut', label: '잘라내기', enabled: p.editFlags.canCut },
        { role: 'copy', label: '복사', enabled: p.editFlags.canCopy },
        { role: 'paste', label: '붙여넣기', enabled: p.editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll', label: '모두 선택' },
      );
    } else if (p.selectionText) {
      items.push({ role: 'copy', label: '복사' });
    }
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });
  win.on('query-session-end', () => { quitting = true; });
  win.on('session-end', () => { quitting = true; flushAll(); });
}

function visibleOnSomeScreen(b) {
  return screen.getAllDisplays().some(({ workArea: a }) =>
    b.x < a.x + a.width - 40 && b.x + b.width > a.x + 40 && b.y >= a.y - 20 && b.y < a.y + a.height - 40);
}

function clampTo(b, a) {
  return {
    ...b,
    x: Math.min(Math.max(b.x, a.x), a.x + a.width - b.width),
    y: Math.min(Math.max(b.y, a.y), a.y + a.height - b.height),
  };
}

function placeNote(ws, near) {
  const width = ws.w || 300;
  const height = ws.h || 300;
  if (Number.isFinite(ws.x) && Number.isFinite(ws.y)) {
    const b = { x: ws.x, y: ws.y, width, height };
    if (visibleOnSomeScreen(b)) return b;
  }
  if (near && !near.isDestroyed()) {
    const nb = near.getBounds();
    const area = screen.getDisplayMatching(nb).workArea;
    let x = nb.x + nb.width + 12;
    let y = nb.y;
    if (x + width > area.x + area.width) { x = nb.x + 32; y = nb.y + 32; }
    return clampTo({ x, y, width, height }, area);
  }
  const area = screen.getPrimaryDisplay().workArea;
  const k = noteWins.size % 8;
  return { x: area.x + area.width - width - 64 - k * 28, y: area.y + 56 + k * 28, width, height };
}

// ── 메모 창 ───────────────────────────────────────────────
function openNote(id, { focus = true, near = null } = {}) {
  const note = notes.get(id);
  if (!note || note.deleted) return null;
  let win = noteWins.get(id);
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    if (focus) { win.show(); win.focus(); } else win.showInactive();
    return win;
  }
  const ws = (state.windows[id] ||= {});
  win = new BrowserWindow({
    ...placeNote(ws, near),
    minWidth: 220,
    minHeight: 170,
    frame: false,
    show: false,
    title: '메모',
    icon: winIcon(),
    backgroundColor: paper(note.color),
    fullscreenable: false,
    maximizable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), sandbox: true, contextIsolation: true, spellcheck: false },
  });
  if (ws.top) win.setAlwaysOnTop(true, 'floating');
  noteWins.set(id, win);
  ws.open = true;
  saveState();
  harden(win);
  win.loadURL(`app://sticky/note.html?id=${encodeURIComponent(id)}`);
  win.once('ready-to-show', () => { if (focus) { win.show(); win.focus(); } else win.showInactive(); });
  const remember = debounce(() => {
    if (win.isDestroyed() || win.isMinimized()) return;
    const b = win.getBounds();
    Object.assign(ws, { x: b.x, y: b.y, w: b.width, h: b.height });
    saveState();
  }, 300);
  win.on('move', remember);
  win.on('resize', remember);
  win.on('closed', () => {
    if (noteWins.get(id) === win) noteWins.delete(id);
    if (quitting) return;
    ws.open = false;
    saveState();
    const n = notes.get(id);
    if (n && !n.deleted && isBlankHtml(n.html)) removeNote(id); // 빈 메모는 닫으면 버려
  });
  return win;
}

function createNote({ color, near } = {}) {
  const n = makeNote(color);
  notes.set(n.id, n);
  saveNotes();
  broadcast(n, { remote: false, from: null });
  openNote(n.id, { focus: true, near });
  return n;
}

function removeNote(id) {
  const cur = notes.get(id);
  if (!cur || cur.deleted) return;
  const n = { ...cur, html: '', deleted: true, updated: Math.max(Date.now(), cur.updated + 1) };
  notes.set(id, n);
  saveNotes();
  delete state.windows[id];
  saveState();
  const w = noteWins.get(id);
  noteWins.delete(id);
  if (w && !w.isDestroyed()) w.destroy();
  broadcast(n, { remote: false, from: null });
}

function updateNote(id, patch, from) {
  const cur = notes.get(id);
  if (!cur || cur.deleted) return null;
  const n = { ...cur, updated: Math.max(Date.now(), cur.updated + 1) };
  if (typeof patch?.html === 'string') n.html = patch.html;
  if (COLORS.includes(patch?.color)) n.color = patch.color;
  notes.set(id, n);
  saveNotes();
  if (n.color !== cur.color) noteWins.get(id)?.setBackgroundColor(paper(n.color));
  broadcast(n, { remote: false, from });
  return n;
}

function broadcast(note, meta) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('notes:changed', note, meta);
  }
}

function showAll() {
  const wins = [...noteWins.values()].filter(w => !w.isDestroyed());
  if (!wins.length) { showList(); return; }
  for (const w of wins) {
    if (w.isMinimized()) w.restore();
    w.showInactive();
    w.moveTop();
  }
  wins[wins.length - 1].focus();
}

// ── 목록 창 ───────────────────────────────────────────────
function createList(show) {
  const saved = state.list;
  const area = screen.getPrimaryDisplay().workArea;
  const b = saved && visibleOnSomeScreen(saved) ? saved
    : { width: 380, height: 620, x: Math.round(area.x + (area.width - 380) / 2), y: Math.round(area.y + (area.height - 620) / 2) };
  listWin = new BrowserWindow({
    ...b,
    minWidth: 300,
    minHeight: 380,
    show: false,
    title: 'Sticky',
    icon: winIcon(),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1C1C1E' : '#F2F2F7',
    ...(IS_MAC ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 16 } } : { frame: false }),
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), sandbox: true, contextIsolation: true, spellcheck: false,
      backgroundThrottling: false, // 숨겨져 있어도 동기화 타이머가 늦어지지 않게
    },
  });
  harden(listWin);
  listWin.loadURL('app://sticky/list.html');
  if (show) listWin.once('ready-to-show', () => { listWin.show(); listWin.focus(); });
  const remember = debounce(() => {
    if (!listWin || listWin.isDestroyed() || listWin.isMinimized()) return;
    state.list = listWin.getBounds();
    saveState();
  }, 300);
  listWin.on('move', remember);
  listWin.on('resize', remember);
  listWin.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    listWin.hide();
  });
  listWin.on('closed', () => { listWin = null; });
}

function showList() {
  if (!listWin || listWin.isDestroyed()) createList(false);
  if (listWin.isMinimized()) listWin.restore();
  listWin.show();
  listWin.focus();
}

// ── 트레이·메뉴 ───────────────────────────────────────────
function trayImage() {
  const img = nativeImage.createFromPath(path.join(ASSETS, 'tray', IS_MAC ? 'trayTemplate.png' : 'tray.png'));
  if (IS_MAC) img.setTemplateImage(true);
  return img;
}

function buildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '새 메모', accelerator: 'CommandOrControl+Alt+N', click: () => createNote() },
    { label: '메모 목록', click: showList },
    { label: '모든 메모 앞으로', click: showAll },
    { type: 'separator' },
    {
      label: '로그인할 때 자동 실행', type: 'checkbox', checked: !!state.settings.openAtLogin, enabled: app.isPackaged,
      click: (item) => setSetting('openAtLogin', item.checked),
    },
    { type: 'separator' },
    { label: 'Sticky 종료', click: () => app.quit() },
  ]));
}

function buildMacMenu() {
  const focusedNear = () => BrowserWindow.getFocusedWindow();
  return Menu.buildFromTemplate([
    {
      label: 'Sticky',
      submenu: [
        { role: 'about', label: 'Sticky에 관하여' },
        { type: 'separator' },
        { role: 'hide', label: 'Sticky 가리기' },
        { role: 'hideOthers', label: '기타 가리기' },
        { role: 'unhide', label: '모두 보기' },
        { type: 'separator' },
        { role: 'quit', label: 'Sticky 종료' },
      ],
    },
    {
      label: '파일',
      submenu: [
        { label: '새 메모', accelerator: 'Cmd+N', click: () => createNote({ near: focusedNear() }) },
        { label: '메모 목록', accelerator: 'Cmd+0', click: showList },
        { type: 'separator' },
        { role: 'close', label: '닫기' },
      ],
    },
    {
      label: '편집',
      submenu: [
        { role: 'undo', label: '실행 취소' },
        { role: 'redo', label: '다시 실행' },
        { type: 'separator' },
        { role: 'cut', label: '잘라내기' },
        { role: 'copy', label: '복사' },
        { role: 'paste', label: '붙여넣기' },
        { role: 'pasteAndMatchStyle', label: '서식 없이 붙여넣기' },
        { role: 'selectAll', label: '모두 선택' },
      ],
    },
    {
      label: '윈도우',
      submenu: [
        { role: 'minimize', label: '최소화' },
        { label: '모든 메모 앞으로', click: showAll },
        { role: 'front', label: '모두 앞으로 가져오기' },
      ],
    },
  ]);
}

function applyLoginItem() {
  if (!app.isPackaged || TEST) return; // 개발·테스트용 실행 파일을 시작 프로그램에 올리면 안 되니까
  app.setLoginItemSettings({ openAtLogin: !!state.settings.openAtLogin, args: ['--hidden'] });
}

function setSetting(key, value) {
  if (key === 'openAtLogin') {
    state.settings.openAtLogin = !!value;
    applyLoginItem();
  }
  saveState();
  buildTrayMenu();
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('settings:changed', publicSettings());
  return publicSettings();
}

function publicSettings() {
  return { ...state.settings, version: app.getVersion(), platform: process.platform, packaged: app.isPackaged };
}

// ── IPC ───────────────────────────────────────────────────
const winOf = e => BrowserWindow.fromWebContents(e.sender);
const idOf = e => [...noteWins].find(([, w]) => w.webContents === e.sender)?.[0];

ipcMain.handle('notes:all', () => [...notes.values()]);
ipcMain.handle('notes:get', (_e, id) => notes.get(id) || null);
ipcMain.handle('notes:update', (_e, id, patch, from) => updateNote(id, patch, from));
ipcMain.on('notes:updateSync', (e, id, patch, from) => { updateNote(id, patch, from); e.returnValue = true; });
ipcMain.handle('notes:create', (e, opts = {}) => createNote({ color: opts.color, near: winOf(e) }).id);
ipcMain.handle('notes:open', (_e, id) => { openNote(id, { focus: true }); });
ipcMain.handle('notes:delete', (_e, id) => removeNote(id));
ipcMain.handle('notes:applyRemote', (_e, list) => {
  const changed = [];
  for (const raw of Array.isArray(list) ? list : []) {
    if (!raw || !raw.id) continue;
    const r = normalize(raw);
    if (!isNewer(r, notes.get(r.id))) continue;
    notes.set(r.id, r);
    changed.push(r);
    const w = noteWins.get(r.id);
    if (r.deleted) {
      noteWins.delete(r.id);
      delete state.windows[r.id];
      if (w && !w.isDestroyed()) w.destroy();
    } else if (w && !w.isDestroyed()) {
      w.setBackgroundColor(paper(r.color));
    }
  }
  if (changed.length) {
    saveNotes();
    saveState();
    for (const n of changed) broadcast(n, { remote: true, from: null });
  }
  return changed.length;
});
ipcMain.handle('win:close', e => winOf(e)?.close());
ipcMain.handle('win:minimize', e => winOf(e)?.minimize());
ipcMain.handle('win:getTop', e => winOf(e)?.isAlwaysOnTop() ?? false);
ipcMain.handle('win:setTop', (e, on) => {
  const w = winOf(e);
  if (!w) return false;
  w.setAlwaysOnTop(!!on, 'floating');
  const id = idOf(e);
  if (id && state.windows[id]) { state.windows[id].top = !!on; saveState(); }
  return w.isAlwaysOnTop();
});
ipcMain.handle('list:show', () => showList());
ipcMain.handle('settings:get', () => publicSettings());
ipcMain.handle('settings:set', (_e, key, value) => setSetting(key, value));
ipcMain.handle('app:openExternal', (_e, url) => {
  if (/^https:\/\/(github\.com|limmmmmmn\.github\.io|console\.firebase\.google\.com)\//.test(String(url))) shell.openExternal(url);
});
// 맥은 서명이 없어서 자동 업데이트가 안 돼. 새 버전이 있으면 목록 창에 알려만 줘.
ipcMain.handle('app:checkUpdate', async () => {
  if (!app.isPackaged || !IS_MAC) return null;
  try {
    const res = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { 'User-Agent': 'Sticky' } });
    if (!res.ok) return null;
    const { tag_name: tag, html_url: url } = await res.json();
    const latest = String(tag || '').replace(/^v/, '');
    return isNewerVersion(latest, app.getVersion()) ? { version: latest, url } : null;
  } catch {
    return null;
  }
});

function isNewerVersion(a, b) {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

function flushAll() {
  notesFile?.flush();
  stateFile?.flush();
}

// ── 시작 ─────────────────────────────────────────────────
const WELCOME = '<div><b>Sticky에 온 걸 환영해요 👋</b></div><div><br></div><ul class="check">'
  + '<li data-done="true">메모는 쓰는 즉시 저장돼요</li>'
  + '<li>＋ 로 새 메모, ··· 에서 색 바꾸기</li>'
  + '<li>📌 누르면 항상 위에 떠 있어요</li>'
  + '<li>어디서든 Ctrl+Alt+N 으로 새 메모</li></ul>';

app.whenReady().then(async () => {
  // app://sticky/… → out/desktop/… (fs로 읽어서 설치본의 asar 안에서도 똑같이 동작해)
  protocol.handle('app', async (req) => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(ROOT, decodeURIComponent(pathname)));
    if (!file.startsWith(ROOT + path.sep)) return new Response('forbidden', { status: 403 });
    try {
      const body = await fs.promises.readFile(file);
      return new Response(body, { headers: { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' } });
    } catch {
      return new Response('not found', { status: 404 });
    }
  });

  const firstRun = loadData();
  Menu.setApplicationMenu(IS_MAC ? buildMacMenu() : null);
  if (IS_MAC) app.dock?.setMenu(Menu.buildFromTemplate([{ label: '새 메모', click: () => createNote() }]));

  tray = new Tray(trayImage());
  tray.setToolTip('Sticky');
  buildTrayMenu();
  if (!IS_MAC) tray.on('click', showAll);
  applyLoginItem();

  const hidden = process.argv.includes('--hidden') || (IS_MAC && app.getLoginItemSettings().wasOpenedAtLogin);
  const reopen = Object.entries(state.windows)
    .filter(([id, ws]) => ws.open && notes.get(id) && !notes.get(id).deleted)
    .map(([id]) => id);

  if (firstRun) {
    const hello = makeNote('yellow', WELCOME.replace('Ctrl+Alt+N', IS_MAC ? '⌘⌥N' : 'Ctrl+Alt+N'));
    notes.set(hello.id, hello);
    saveNotes();
    createList(true);
    listWin.once('ready-to-show', () => openNote(hello.id, { focus: false, near: listWin }));
  } else {
    createList(!hidden && reopen.length === 0);
    for (const id of reopen) openNote(id, { focus: false });
  }

  globalShortcut.register('CommandOrControl+Alt+N', () => createNote());

  if (app.isPackaged && !IS_MAC && !TEST) {
    try {
      const { autoUpdater } = require('electron-updater');
      autoUpdater.checkForUpdatesAndNotify().catch(() => {});
    } catch { /* 업데이트 확인 실패는 무시 */ }
  }

  if (process.env.STICKY_SHOT) runShots(process.env.STICKY_SHOT);
});

app.on('second-instance', () => { showList(); showAll(); });
app.on('activate', () => showList());
app.on('window-all-closed', () => { /* 트레이에 남아 있어 */ });
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  flushAll();
});

// 테스트용: 창들을 PNG로 찍고 종료해. (STICKY_SHOT=폴더)
async function runShots(dir) {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  await wait(Number(process.env.STICKY_SHOT_WAIT) || 2500);
  if (process.env.STICKY_SHOT_SCRIPT) {
    try { await require(path.resolve(process.env.STICKY_SHOT_SCRIPT))({ notes, noteWins, listWin, createNote, openNote, wait, showList }); } catch (err) { console.error(err); }
  }
  fs.mkdirSync(dir, { recursive: true });
  const all = [['list', listWin], ...[...noteWins].map(([id, w], i) => [`note${i + 1}`, w])];
  for (const [name, w] of all) {
    if (!w || w.isDestroyed()) continue;
    if (!w.isVisible()) w.showInactive();
    await wait(300);
    const img = await w.webContents.capturePage();
    fs.writeFileSync(path.join(dir, `${name}.png`), img.toPNG());
  }
  console.log('shots saved', dir);
  app.quit();
}
