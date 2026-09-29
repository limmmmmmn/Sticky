// 동기화 규칙 테스트: 가짜 저장소 + 가짜 서버로 돌려 봐.  npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../src/shared/sync-engine.js';

const note = (id, updated, extra = {}) => ({ id, html: id, color: 'yellow', created: 1, updated, deleted: false, ...extra });
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

function fakeStore(initial) {
  const map = new Map(initial.map(n => [n.id, n]));
  const listeners = new Set();
  return {
    map,
    all: async () => [...map.values()],
    applyRemote: async (list) => {
      for (const r of list) if (!map.get(r.id) || r.updated > map.get(r.id).updated) map.set(r.id, r);
    },
    onLocalChange: (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    edit(n) { map.set(n.id, n); for (const f of listeners) f(n); },
  };
}

function fakeRemote({ fail = false } = {}) {
  const r = {
    onData: null,
    writes: [],
    removed: [],
    subscribe(onData) { r.onData = onData; return () => { r.onData = null; }; },
    async write(list) { if (fail) throw Object.assign(new Error('x'), { code: 'permission-denied' }); r.writes.push(list.map(n => n.id)); },
    async remove(ids) { r.removed.push(...ids); },
    push(docs, meta = {}) { return r.onData(docs, { fromCache: false, pending: false, changes: docs, ...meta }); },
  };
  return r;
}

test('첫 대조: 더 새 것끼리 서로 주고받아', async () => {
  const store = fakeStore([note('A', 10), note('B', 20)]);
  const remote = fakeRemote();
  const statuses = [];
  const engine = createEngine({ store, onStatus: s => statuses.push(s.state), delay: 5 });
  engine.start(remote);
  await remote.push([note('B', 30), note('C', 5)]);
  await tick(20);
  assert.equal(store.map.get('B').updated, 30);
  assert.ok(store.map.has('C'));
  assert.deepEqual(remote.writes, [['A']]);
  assert.equal(engine.status.state, 'synced');
});

test('캐시에서 온 첫 스냅샷은 무시하고 서버 응답을 기다려', async () => {
  const store = fakeStore([note('A', 10)]);
  const remote = fakeRemote();
  const engine = createEngine({ store, delay: 5 });
  engine.start(remote);
  await remote.push([], { fromCache: true });
  await tick(20);
  assert.deepEqual(remote.writes, []);
  await remote.push([]);
  await tick(20);
  assert.deepEqual(remote.writes, [['A']]);
});

test('대조 뒤 로컬 수정은 모아서 올리고, 원격 수정은 받아 와', async () => {
  const store = fakeStore([]);
  const remote = fakeRemote();
  const engine = createEngine({ store, delay: 10 });
  engine.start(remote);
  await remote.push([]);
  store.edit(note('D', 100));
  store.edit(note('D', 101));
  store.edit(note('E', 102));
  await tick(40);
  assert.deepEqual(remote.writes, [['D', 'E']]);
  await remote.push([note('F', 50)], { changes: [note('F', 50)] });
  assert.ok(store.map.has('F'));
});

test('대조 전에 줄 선 변경이라도 서버 것이 더 새면 올리지 않아', async () => {
  const store = fakeStore([note('A', 10)]);
  const remote = fakeRemote();
  const engine = createEngine({ store, delay: 5 });
  engine.start(remote);
  store.edit(note('A', 11));
  await remote.push([note('A', 50)]);
  await tick(20);
  assert.deepEqual(remote.writes, []);
  assert.equal(store.map.get('A').updated, 50);
});

test('오래된 삭제 흔적은 서버에서 정리해', async () => {
  const store = fakeStore([]);
  const remote = fakeRemote();
  const engine = createEngine({ store, delay: 5, now: () => 100 * 24 * 3600 * 1000 });
  engine.start(remote);
  await remote.push([note('old', 1, { deleted: true }), note('live', 2)]);
  await tick(10);
  assert.deepEqual(remote.removed, ['old']);
});

test('올리기 실패하면 오류 상태로 두고 다시 줄 세워', async () => {
  const store = fakeStore([note('A', 10)]);
  const remote = fakeRemote({ fail: true });
  const engine = createEngine({ store, delay: 5 });
  engine.start(remote);
  await remote.push([]);
  await tick(20);
  assert.equal(engine.status.state, 'error');
  assert.equal(engine.status.error, 'permission-denied');
});

test('1MB 가까운 메모는 빼고 올리면서 알려 줘', async () => {
  const big = note('big', 10, { html: 'x'.repeat(950_000) });
  const store = fakeStore([big, note('ok', 11)]);
  const remote = fakeRemote();
  const engine = createEngine({ store, delay: 5 });
  engine.start(remote);
  await remote.push([]);
  await tick(20);
  assert.deepEqual(remote.writes, [['ok']]);
  assert.equal(engine.status.tooLarge, 1);
});

test('로그아웃하면 멈추고 더는 올리지 않아', async () => {
  const store = fakeStore([]);
  const remote = fakeRemote();
  const engine = createEngine({ store, delay: 5 });
  engine.start(remote);
  await remote.push([]);
  engine.stop();
  store.edit(note('X', 5));
  await tick(20);
  assert.deepEqual(remote.writes, []);
  assert.equal(engine.status.state, 'signedOut');
});
