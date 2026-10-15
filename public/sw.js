/* 기억의 집 · 홈 화면 앱용 서비스 워커
   화면은 늘 최신을 먼저 받고(네트워크 우선), 연결이 끊기면 마지막으로 본 화면을 보여 준다.
   API·사진 업로드는 건드리지 않는다. */
const CACHE = "memory-house-v1";
const SHELL = ["/intro", "/static/angel.js", "/static/logo.svg", "/static/favicon.svg", "/static/icon-192.png", "/img/portrait.jpg"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/admin")) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok && (req.mode === "navigate" || /^\/(static|img)\//.test(url.pathname))) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || (req.mode === "navigate" ? caches.match("/intro") : Response.error())))
  );
});
