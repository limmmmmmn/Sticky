// 아이폰 웹앱의 메모 저장소 (IndexedDB). 동기화 엔진이 쓰는 모양(all/applyRemote/onLocalChange)도 맞춰 둬.
import { makeNote, normalize, isNewer, TOMBSTONE_TTL } from '../shared/notes.js';

const DB = 'sticky';
const OS = 'notes';
const LS_KEY = 'sticky-notes';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(OS, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OS, mode);
    const out = fn(tx.objectStore(OS));
    tx.oncomplete = () => resolve(out?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function createLocalStore() {
  let db = null;
  try { db = await openDB(); } catch { db = null; }

  const map = new Map();
  let rows = [];
  if (db) {
    try { rows = await run(db, 'readonly', s => s.getAll()); } catch { rows = []; }
  } else {
    try { rows = JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { rows = []; }
  }
  const now = Date.now();
  const expired = [];
  for (const raw of rows) {
    const n = normalize(raw);
    if (n.deleted && now - n.updated > TOMBSTONE_TTL) expired.push(n.id);
    else map.set(n.id, n);
  }

  // 사파리가 저장 공간을 비우지 않게 부탁해 둬 (홈 화면 앱이면 보통 허락돼)
  navigator.storage?.persist?.().catch(() => {});

  const listeners = new Set();
  const emit = (n, meta) => { for (const f of listeners) f(n, meta); };

  function persist(list) {
    if (db) {
      run(db, 'readwrite', s => { for (const n of list) s.put(n); }).catch(err => console.error('저장 실패', err));
    } else {
      try { localStorage.setItem(LS_KEY, JSON.stringify([...map.values()])); } catch (err) { console.error('저장 실패', err); }
    }
  }
  if (db && expired.length) run(db, 'readwrite', s => { for (const id of expired) s.delete(id); }).catch(() => {});

  function put(n, meta) {
    map.set(n.id, n);
    persist([n]);
    emit(n, meta);
    return n;
  }

  return {
    all: () => [...map.values()],
    get: id => map.get(id),
    create: opts => put(makeNote(opts), { remote: false }),
    update(id, patch) {
      const cur = map.get(id);
      if (!cur || cur.deleted) return null;
      return put({ ...cur, ...patch, id, updated: Math.max(Date.now(), cur.updated + 1) }, { remote: false });
    },
    remove(id) {
      const cur = map.get(id);
      if (!cur || cur.deleted) return null;
      put({ ...cur, html: '', deleted: true, updated: Math.max(Date.now(), cur.updated + 1) }, { remote: false });
      return cur;
    },
    restore(prev) {
      const cur = map.get(prev.id);
      return put({ ...prev, deleted: false, updated: Math.max(Date.now(), (cur?.updated || 0) + 1) }, { remote: false });
    },
    applyRemote(list) {
      const changed = [];
      for (const raw of list) {
        const r = normalize(raw);
        if (!isNewer(r, map.get(r.id))) continue;
        map.set(r.id, r);
        changed.push(r);
      }
      if (changed.length) {
        persist(changed);
        for (const n of changed) emit(n, { remote: true });
      }
      return changed.length;
    },
    onChange(f) { listeners.add(f); return () => listeners.delete(f); },
    onLocalChange(f) { return this.onChange((n, meta) => { if (!meta.remote) f(n); }); },
  };
}
