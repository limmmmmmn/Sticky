// 빌드할 때 버전과 파일 목록이 채워져. 파일이 바뀌면 버전이 바뀌어서 폰이 새 걸 받아.
const VERSION = '%VERSION%';
const FILES = %FILES%;
const CACHE = `sticky-${VERSION}`;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('sticky-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  // 페이지: 새 버전이 있으면 받되, 2.5초 안에 안 오면 저장해 둔 걸로 바로 열어
  if (req.mode === 'navigate') {
    const fresh = fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put('./', copy)); }
      return res;
    });
    const cached = () => caches.match('./');
    e.respondWith(
      Promise.race([fresh.catch(() => null), new Promise(r => setTimeout(r, 2500))])
        .then(res => res || cached())
        .then(res => res || fresh),
    );
    return;
  }

  // 나머지(이름에 해시가 붙은 파일, 아이콘): 저장본 먼저
  e.respondWith(caches.match(req).then(hit => hit || fetch(req)));
});
