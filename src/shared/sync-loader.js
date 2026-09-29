// 설정이 있을 때만 Firebase 묶음을 내려받아. 없으면 "동기화 꺼짐" 상태를 돌려줘.
import config from './firebase-config.js';

function disabled(state) {
  const status = { configured: false, state, email: null, error: null };
  const nope = () => Promise.reject(Object.assign(new Error(state), { code: 'sync/' + state }));
  return {
    configured: false,
    status,
    onStatus(f) { f(status); return () => {}; },
    signIn: nope, signUp: nope, signOut: nope, resetPassword: nope,
    flush: () => Promise.resolve(),
  };
}

export async function loadSync(store) {
  if (!config) return disabled('unconfigured');
  try {
    const { createSync } = await import('./sync.js');
    return createSync(config, store);
  } catch (err) {
    console.error('동기화 모듈을 불러오지 못했어', err);
    return disabled('unavailable');
  }
}
