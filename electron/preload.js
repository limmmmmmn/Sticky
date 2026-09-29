// 창(렌더러)에 열어 주는 API. 메모 데이터는 전부 메인 프로세스를 거쳐.
const { contextBridge, ipcRenderer } = require('electron');

// 내가 보낸 변경이 되돌아왔는지 알아보는 표식
const from = Math.random().toString(36).slice(2);
const invoke = (ch, ...args) => ipcRenderer.invoke(ch, ...args);

contextBridge.exposeInMainWorld('sticky', {
  platform: process.platform,
  all: () => invoke('notes:all'),
  get: id => invoke('notes:get', id),
  update: (id, patch) => invoke('notes:update', id, patch, from),
  updateNow: (id, patch) => ipcRenderer.sendSync('notes:updateSync', id, patch, from),
  create: opts => invoke('notes:create', opts || {}),
  open: id => invoke('notes:open', id),
  remove: id => invoke('notes:delete', id),
  applyRemote: list => invoke('notes:applyRemote', list),
  onChange(cb) {
    const h = (_e, note, meta) => cb(note, { remote: !!meta?.remote, self: meta?.from === from });
    ipcRenderer.on('notes:changed', h);
    return () => ipcRenderer.removeListener('notes:changed', h);
  },
  showList: () => invoke('list:show'),
  close: () => invoke('win:close'),
  minimize: () => invoke('win:minimize'),
  isTop: () => invoke('win:getTop'),
  setTop: on => invoke('win:setTop', on),
  settings: () => invoke('settings:get'),
  setSetting: (key, value) => invoke('settings:set', key, value),
  onSettings(cb) { ipcRenderer.on('settings:changed', (_e, s) => cb(s)); },
  checkUpdate: () => invoke('app:checkUpdate'),
  openExternal: url => invoke('app:openExternal', url),
});
