// Firebase(로그인 + Firestore)로 메모를 동기화해. firebase-config.js가 채워져 있을 때만 불러와.
import { initializeApp } from 'firebase/app';
import {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, onAuthStateChanged,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, sendPasswordResetEmail,
} from 'firebase/auth';
import { initializeFirestore, collection, doc, onSnapshot, writeBatch } from 'firebase/firestore';
import { normalize } from './notes.js';
import { createEngine } from './sync-engine.js';

const BATCH_BYTES = 4_000_000;

function firestoreAdapter(db, uid) {
  const col = collection(db, 'users', uid, 'notes');
  const read = d => normalize({ ...d.data(), id: d.id });
  return {
    subscribe(onData, onError) {
      return onSnapshot(col, { includeMetadataChanges: true }, (snap) => {
        const changes = snap.docChanges()
          .filter(c => c.type !== 'removed' && !c.doc.metadata.hasPendingWrites)
          .map(c => read(c.doc));
        onData(snap.docs.map(read), {
          fromCache: snap.metadata.fromCache,
          pending: snap.metadata.hasPendingWrites,
          changes,
        });
      }, onError);
    },
    async write(list) {
      // 사진 든 메모가 많으면 요청 한도(10MB)를 넘을 수 있어서 나눠 보내.
      const commits = [];
      let batch = writeBatch(db);
      let bytes = 0;
      let count = 0;
      for (const n of list) {
        const data = { html: n.deleted ? '' : n.html, color: n.color, created: n.created, updated: n.updated, deleted: !!n.deleted };
        const size = data.html.length + 200;
        if (count && (bytes + size > BATCH_BYTES || count >= 400)) {
          commits.push(batch.commit());
          batch = writeBatch(db);
          bytes = count = 0;
        }
        batch.set(doc(col, n.id), data);
        bytes += size;
        count++;
      }
      if (count) commits.push(batch.commit());
      await Promise.all(commits);
    },
    async remove(ids) {
      const batch = writeBatch(db);
      for (const id of ids.slice(0, 400)) batch.delete(doc(col, id));
      await batch.commit();
    },
  };
}

export function createSync(config, store) {
  const app = initializeApp(config);
  const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
  const db = initializeFirestore(app, {});
  const listeners = new Set();
  let status = { configured: true, state: 'starting', email: null, error: null, lastSynced: null, tooLarge: 0 };
  const emit = (patch) => {
    status = { ...status, ...patch };
    for (const f of listeners) f(status);
  };
  const engine = createEngine({ store, onStatus: s => emit(s) });

  onAuthStateChanged(auth, (user) => {
    if (user) {
      emit({ email: user.email });
      engine.start(firestoreAdapter(db, user.uid));
    } else {
      engine.stop();
      emit({ state: 'signedOut', email: null, error: null });
    }
  });

  return {
    configured: true,
    get status() { return status; },
    onStatus(f) { listeners.add(f); f(status); return () => listeners.delete(f); },
    signIn: (email, pw) => signInWithEmailAndPassword(auth, email.trim(), pw),
    signUp: (email, pw) => createUserWithEmailAndPassword(auth, email.trim(), pw),
    signOut: () => signOut(auth),
    resetPassword: email => sendPasswordResetEmail(auth, email.trim()),
    flush: () => engine.flush(),
  };
}
