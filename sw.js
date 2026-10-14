// 分镜工作台 PWA 离线缓存（部署版）
// 与原仓库 sw.js 的差异：
//  1) 缓存清单只列部署目录里真实存在的文件（原版含 ./分镜工作台.html，会令 addAll 原子失败）
//  2) 缓存名带版本号，便于后续发布时自动清旧缓存
//  3) 导航请求走 network-first（保证重新发布后能拿到新版），静态资源走 cache-first
//  4) 跨域请求不做缓存（避免缓存 jsDelivr 的 opaque 响应）
const CACHE = "storyboard-ws-v3";
const ASSETS = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(ASSETS.map(u => c.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 跨域（CDN 解析库等）交给浏览器直连

  // 导航请求：先网络，失败再回缓存
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then(resp => {
          const copy = resp.clone();
          caches.open(CACHE).then(c => c.put("./index.html", copy)).catch(() => {});
          return resp;
        })
        .catch(() => caches.match("./index.html").then(r => r || caches.match("./")))
    );
    return;
  }

  // 静态资源：先缓存，回退网络并顺带更新缓存
  e.respondWith(
    caches.match(req).then(cached =>
      cached || fetch(req).then(resp => {
        if (resp && resp.status === 200 && resp.type === "basic") {
          const copy = resp.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return resp;
      })
    )
  );
});
