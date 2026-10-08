/* Zyven service worker: installable app shell + push notifications.
   Strategy: network first (so updates always arrive), cache only as an offline fallback.
   Cross-origin requests (Supabase, CDN) are never touched. */
const CACHE = 'zyven-shell-v4';
const SHELL = ['./', 'index.html', 'style.css', 'manifest.json', 'monogram.png',
  'supabase-init.js', 'utils.js', 'adslots.js', 'auth.js', 'ads.js', 'wallet.js', 'payout.js',
  'community.js', 'referral.js', 'pwa.js', 'device.js', 'maintenance.js', 'admin.js', 'app.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {}))))   // one missing file must not break install
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // scripts/styles are always revalidated with the server, so an update is never hidden by a stale HTTP cache
  const live = req.mode === 'navigate' ? req : new Request(req, { cache: 'no-cache' });
  e.respondWith(
    fetch(live)
      .then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())))
  );
});

/* ---------- Push ---------- */
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Zyven', {
    body: d.body || '',
    icon: 'monogram.png',
    badge: 'monogram.png',
    tag: d.tag || undefined,
    data: { url: d.url || '#/notifications' }
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const hash = (e.notification.data && e.notification.data.url) || '#/notifications';
  const target = new URL(hash, self.registration.scope).href;
  const path = hash.replace(/^#/, '');
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.startsWith(self.registration.scope) && 'focus' in c) {
          c.postMessage({ type: 'navigate', path });   // app is already open: just go to the right screen
          return c.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
