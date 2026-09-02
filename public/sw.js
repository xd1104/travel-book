/* 旅途手帳 service worker
 * - App shell：cache-first
 * - 資料（GET /api/data）：network-first、失敗退 cache（離線仍看得到上次載入的行程）
 * - 其他 /api（寫入）：network-only，失敗回明確的離線 JSON
 * - 跨網域（GitHub API / raw）一律放行不攔（Pages 版資料不經 SW cache）
 * 鐵律：skipWaiting + activate 清舊快取 + clients.claim，已安裝 PWA 才吃得到新版
 * 改前端記得把 cache 版本號 +1（SHELL 與 DATA 兩個一起跳，別只跳一個），並同步 app.js 最上面的 APP_VER
 */
const SHELL_CACHE = 'travel-shell-v29';
const DATA_CACHE = 'travel-data-v29';
const KEEP = [SHELL_CACHE, DATA_CACHE];

// 相對於 SW scope 解析（localhost 根目錄或 Pages 子路徑 /travel-book/ 都對）
const BASE = new URL('./', self.location).pathname;
const SHELL = [
  BASE,
  BASE + 'index.html',
  BASE + 'styles.css',
  /* 動效與開場模組（v3.5）。⚠️ 一定要預先快取：離線／殼快取還沒建完時
     motion/splash.js 沒載到，app.js 會走 splashFallback()（畫面救得回來，但沒有開場）；
     兩支 CSS 沒載到則整個 App 是裸 HTML。
     ⚠️ tools/splash-boot.js **刻意不在這裡**：它已經逐字 inline 進 index.html，
        沒有人會去 fetch 它，放進來等於快取一個沒人要的檔案。 */
  BASE + 'motion/motion.css',
  BASE + 'motion/splash.css',
  BASE + 'motion/splash.js',
  BASE + 'keyring-unlock.js',
  BASE + 'app.js',
  BASE + 'manifest.json',
  BASE + 'icons/icon-192.png',
  BASE + 'icons/icon-512.png',
  BASE + 'icons/icon-maskable-512.png',
  BASE + 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function offlineJson() {
  return new Response(JSON.stringify({ ok: false, code: 'offline', message: '目前離線或連不到旅途手帳伺服器。' }), {
    status: 503,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function networkFirst(request, cacheName) {
  try {
    const res = await fetch(request);
    if (res && res.ok) {
      const copy = res.clone();
      caches.open(cacheName).then((c) => c.put(request, copy));
    }
    return res;
  } catch {
    const cached = await caches.match(request);
    return cached || offlineJson();
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // GitHub API/raw 等跨網域直接放行

  // 資料讀取：network-first（不能 cache-first 服務到舊資料）
  if (req.method === 'GET' && url.pathname.endsWith('/api/data')) {
    e.respondWith(networkFirst(req, DATA_CACHE));
    return;
  }

  // 其他 API（寫入類）：network-only
  if (url.pathname.includes('/api/')) {
    e.respondWith(fetch(req).catch(() => offlineJson()));
    return;
  }

  /* 鑰匙圈解鎖模組：network-first（刻意不跟 App shell 一起走 cache-first）。
   * 這支檔案的正本在 keyring repo，由 keyring 的 sync-unlock.yml 自動同步過來——
   * 它更新時**不會**跟著跳下面那個 SHELL_CACHE 版本號，所以若走 cache-first，
   * 手機會永遠停在第一次快取到的那一版，模組的修正永遠到不了使用者手上。
   * 它本來就在 SHELL 預先快取，離線時 networkFirst 一定拿得到快取，不會落到 offlineJson()。 */
  if (req.method === 'GET' && url.pathname.endsWith('/keyring-unlock.js')) {
    e.respondWith(networkFirst(req, SHELL_CACHE));
    return;
  }

  // App shell：cache-first，退 network，再退 index.html
  e.respondWith(
    caches.match(req).then((hit) =>
      hit ||
      fetch(req)
        .then((res) => {
          if (res.ok && req.method === 'GET') {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(BASE + 'index.html'))
    )
  );
});
