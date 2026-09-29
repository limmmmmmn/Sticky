// 동기화의 뼈대. Firebase를 직접 모르고 remote 어댑터만 써서, 가짜 어댑터로 테스트할 수 있어.
//
// store  : { all(), applyRemote(list), onLocalChange(cb) → unsubscribe }
// remote : { subscribe(onData, onError) → unsubscribe, write(list), remove(ids) }
//          onData(docs, { fromCache, pending, changes })
//
// 규칙은 단순해: 메모마다 updated가 더 큰 쪽이 이긴다.
import { isNewer, TOMBSTONE_TTL } from './notes.js';

export const MAX_HTML = 900_000; // Firestore 문서 한 개 한도(1MiB)보다 살짝 작게

export function createEngine({ store, onStatus, delay = 1200, maxWait = 5000, retryMs = 20000, now = Date.now }) {
  let remote = null;
  let ready = false;
  let unsubRemote = null;
  let unsubStore = null;
  let timer = null;
  let firstQueued = 0;
  let retry = null;
  let inflight = 0;
  const pending = new Map();
  let status = { state: 'signedOut', error: null, lastSynced: null, tooLarge: 0 };

  const set = (patch) => { status = { ...status, ...patch }; onStatus?.(status); };

  function queue(n) {
    pending.set(n.id, n);
    if (!ready) return; // 첫 대조가 끝나면 한꺼번에 올라가
    if (!firstQueued) firstQueued = now();
    clearTimeout(timer);
    timer = setTimeout(flush, now() - firstQueued > maxWait ? 0 : delay);
    if (status.state === 'synced') set({ state: 'syncing' });
  }

  async function flush() {
    clearTimeout(timer);
    timer = null;
    firstQueued = 0;
    if (!remote || !ready || !pending.size) return;
    const r = remote;
    const all = [...pending.values()];
    pending.clear();
    const list = all.filter(n => (n.html?.length || 0) <= MAX_HTML);
    const tooLarge = all.length - list.length;
    if (!list.length) { set({ tooLarge }); return; }
    inflight++;
    set({ state: 'syncing', tooLarge });
    try {
      await r.write(list);
      if (r !== remote) return;
      inflight--;
      if (!inflight && !pending.size) set({ state: 'synced', error: null, lastSynced: now() });
    } catch (err) {
      if (r !== remote) return;
      inflight--;
      for (const n of list) if (!pending.has(n.id)) pending.set(n.id, n);
      set({ state: 'error', error: err?.code || String(err) });
    }
  }

  async function onData(docs, meta) {
    const r = remote;
    if (!ready) {
      if (meta.fromCache) return; // 서버 응답을 받아야 제대로 비교할 수 있어
      ready = true;
      const local = await store.all();
      if (r !== remote) return;
      const mine = new Map(local.map(n => [n.id, n]));
      const theirs = new Map(docs.map(n => [n.id, n]));
      const incoming = docs.filter(d => isNewer(d, mine.get(d.id)));
      if (incoming.length) await store.applyRemote(incoming);
      for (const n of local) {
        const queued = pending.get(n.id);
        if (isNewer(n, theirs.get(n.id)) && (!queued || n.updated > queued.updated)) pending.set(n.id, n);
      }
      // 대조 전에 줄 서 있던 변경이라도 서버 쪽이 더 새거면 올리지 않아
      for (const [id, n] of pending) if (!isNewer(n, theirs.get(id))) pending.delete(id);
      const stale = docs.filter(d => d.deleted && now() - d.updated > TOMBSTONE_TTL).map(d => d.id);
      if (stale.length) r.remove(stale).catch(() => {});
      if (pending.size) await flush();
      else set({ state: 'synced', error: null, lastSynced: now() });
      return;
    }
    if (meta.changes.length) await store.applyRemote(meta.changes);
    if (r !== remote) return;
    if (meta.fromCache) set({ state: 'offline' });
    else if (!pending.size && !inflight && !meta.pending) set({ state: 'synced', error: null, lastSynced: now() });
  }

  function listen() {
    unsubRemote = remote.subscribe(
      (docs, meta) => onData(docs, meta).catch(err => set({ state: 'error', error: String(err) })),
      (err) => {
        set({ state: 'error', error: err?.code || String(err) });
        // 규칙이 아직 없거나 잠깐 끊겼을 때 알아서 다시 붙어
        const r = remote;
        clearTimeout(retry);
        retry = setTimeout(() => {
          if (r !== remote) return;
          unsubRemote?.();
          ready = false;
          listen();
        }, retryMs);
      },
    );
  }

  return {
    start(adapter) {
      this.stop();
      remote = adapter;
      ready = false;
      set({ state: 'connecting', error: null });
      unsubStore = store.onLocalChange(n => { if (remote) queue(n); });
      listen();
    },
    stop() {
      unsubRemote?.();
      unsubStore?.();
      unsubRemote = unsubStore = null;
      clearTimeout(timer);
      clearTimeout(retry);
      timer = retry = null;
      remote = null;
      ready = false;
      inflight = 0;
      pending.clear();
      set({ state: 'signedOut', error: null });
    },
    flush,
    get status() { return status; },
  };
}
