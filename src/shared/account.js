// 동기화 로그인 화면. 데스크톱 설정 패널과 아이폰 설정 시트가 같이 써.
import { icon } from './icons.js';

const AUTH_ERRORS = {
  'auth/invalid-email': '이메일 형식이 올바르지 않아요.',
  'auth/missing-email': '이메일을 입력해 주세요.',
  'auth/missing-password': '비밀번호를 입력해 주세요.',
  'auth/invalid-credential': '이메일 또는 비밀번호가 맞지 않아요.',
  'auth/invalid-login-credentials': '이메일 또는 비밀번호가 맞지 않아요.',
  'auth/wrong-password': '이메일 또는 비밀번호가 맞지 않아요.',
  'auth/user-not-found': '가입되지 않은 이메일이에요. 계정을 먼저 만들어 주세요.',
  'auth/email-already-in-use': '이미 가입된 이메일이에요. 로그인해 주세요.',
  'auth/weak-password': '비밀번호는 6자 이상이어야 해요.',
  'auth/network-request-failed': '인터넷 연결을 확인해 주세요.',
  'auth/too-many-requests': '시도가 너무 많아요. 잠시 후 다시 해 주세요.',
  'auth/operation-not-allowed': 'Firebase에서 이메일 로그인이 꺼져 있어요.',
  'auth/configuration-not-found': 'Firebase에서 이메일 로그인이 꺼져 있어요.',
};

export function authMessage(err) {
  return AUTH_ERRORS[err?.code] || '문제가 생겼어요. 잠시 후 다시 시도해 주세요.';
}

function errorText(code) {
  if (code === 'permission-denied') return '권한이 없어요 · 보안 규칙을 확인해 주세요';
  if (code === 'unavailable') return '서버에 연결할 수 없어요';
  return '동기화 오류 · 잠시 후 다시 시도해요';
}

export function statusLine(s) {
  let line;
  switch (s.state) {
    case 'unconfigured': line = { icon: 'cloudOff', text: '이 기기에만 저장 중' }; break;
    case 'unavailable': line = { icon: 'cloudOff', text: '동기화를 불러오지 못했어요' }; break;
    case 'signedOut': line = { icon: 'cloudOff', text: '로그인하면 기기끼리 동기화돼요' }; break;
    case 'starting': line = { icon: 'cloud', text: '확인하는 중…' }; break;
    case 'connecting': line = { icon: 'cloud', text: '연결하는 중…' }; break;
    case 'syncing': line = { icon: 'cloud', text: '동기화하는 중…' }; break;
    case 'offline': line = { icon: 'cloudOff', text: '오프라인 · 연결되면 올라가요' }; break;
    case 'error': line = { icon: 'cloudOff', text: errorText(s.error), bad: true }; break;
    default: line = { icon: 'cloudCheck', text: '동기화됨', ok: true };
  }
  if (s.tooLarge) line.text += ` · 너무 큰 메모 ${s.tooLarge}개는 못 올렸어요`;
  return line;
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function mountAccount(root, sync) {
  let view = null;
  let mode = 'signin';
  let busy = false;

  const $ = sel => root.querySelector(sel);
  const say = (text, kind = 'error') => {
    const m = $('.acct-msg');
    if (!m) return;
    m.textContent = text || '';
    m.dataset.kind = kind;
  };

  function renderSignedOut() {
    const signup = mode === 'signup';
    root.innerHTML = `
      <div class="acct">
        <div class="acct-hero">${icon('cloud')}</div>
        <p class="acct-title">기기끼리 메모 맞추기</p>
        <p class="acct-sub">같은 계정으로 로그인하면 윈도우·맥·아이폰 메모가 자동으로 맞춰져요.</p>
        <form class="acct-form" novalidate>
          <div class="group">
            <input class="field" type="email" name="email" placeholder="이메일" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false" inputmode="email">
            <input class="field" type="password" name="password" placeholder="비밀번호${signup ? ' (6자 이상)' : ''}" autocomplete="${signup ? 'new-password' : 'current-password'}">
          </div>
          <p class="acct-msg" role="alert"></p>
          <button class="btn primary" type="submit">${signup ? '계정 만들기' : '로그인'}</button>
          <button class="btn secondary" type="button" data-act="toggle">${signup ? '이미 계정이 있어요 · 로그인' : '처음이에요 · 계정 만들기'}</button>
          ${signup ? '' : '<button class="link" type="button" data-act="reset">비밀번호를 잊었어요</button>'}
        </form>
      </div>`;
    const form = $('form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (busy) return;
      const email = form.email.value.trim();
      const pw = form.password.value;
      if (!email) return say('이메일을 입력해 주세요.');
      if (pw.length < 6) return say('비밀번호는 6자 이상이어야 해요.');
      busy = true;
      form.querySelector('[type=submit]').disabled = true;
      say('');
      try {
        if (mode === 'signup') await sync.signUp(email, pw);
        else await sync.signIn(email, pw);
      } catch (err) {
        say(authMessage(err));
      } finally {
        busy = false;
        const b = form.querySelector('[type=submit]');
        if (b) b.disabled = false;
      }
    });
    $('[data-act=toggle]').addEventListener('click', () => {
      const email = form.email.value;
      mode = signup ? 'signin' : 'signup';
      renderSignedOut();
      $('form').email.value = email;
    });
    $('[data-act=reset]')?.addEventListener('click', async () => {
      const email = form.email.value.trim();
      if (!email) return say('비밀번호를 받을 이메일을 먼저 입력해 주세요.');
      try {
        await sync.resetPassword(email);
        say('비밀번호 재설정 메일을 보냈어요. 메일함을 확인해 주세요.', 'ok');
      } catch (err) {
        say(authMessage(err));
      }
    });
  }

  function renderSignedIn(s) {
    root.innerHTML = `
      <div class="acct">
        <div class="group">
          <div class="row">
            <span class="row-icon" data-status-icon></span>
            <div class="row-main">
              <div class="row-title">${esc(s.email || '로그인됨')}</div>
              <div class="row-sub" data-status></div>
            </div>
          </div>
        </div>
        <button class="btn secondary danger" type="button" data-act="signout">로그아웃</button>
        <p class="acct-foot">로그아웃해도 이 기기에 있는 메모는 그대로 남아요.</p>
      </div>`;
    $('[data-act=signout]').addEventListener('click', () => sync.signOut().catch(() => {}));
  }

  function renderOff(s) {
    root.innerHTML = `
      <div class="acct">
        <div class="acct-hero">${icon('cloudOff')}</div>
        <p class="acct-title">동기화 꺼짐</p>
        <p class="acct-sub">${s.state === 'unavailable'
          ? '동기화 모듈을 불러오지 못했어요. 인터넷 연결을 확인하고 앱을 다시 열어 주세요.'
          : '지금은 메모가 이 기기에만 저장돼요. 동기화 설정이 끝나면 여기서 로그인할 수 있어요.'}</p>
      </div>`;
  }

  return sync.onStatus((s) => {
    const next = !s.configured ? 'off' : s.email ? 'in' : s.state === 'starting' ? 'wait' : 'out';
    if (next !== view) {
      view = next;
      if (next === 'off') renderOff(s);
      else if (next === 'wait') root.innerHTML = '<div class="acct"><p class="acct-sub">확인하는 중…</p></div>';
      else if (next === 'in') renderSignedIn(s);
      else { mode = 'signin'; renderSignedOut(); }
    }
    if (view === 'in') {
      const line = statusLine(s);
      $('[data-status]').textContent = line.text;
      $('[data-status-icon]').innerHTML = icon(line.icon);
      $('[data-status-icon]').dataset.tone = line.bad ? 'bad' : (line.ok ? 'ok' : '');
    }
  });
}
