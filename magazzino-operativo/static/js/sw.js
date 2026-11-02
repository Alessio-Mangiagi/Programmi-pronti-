// "><(((º> sabusabu <º)))><"
// Service worker minimo: rende l'app installabile sul telefono e tiene una copia
// della pagina e degli script per aprirla anche senza rete. Strategia "prima la
// rete": si usa la cache solo se il server non risponde, così gli aggiornamenti
// arrivano subito. Le API non vengono mai messe in cache.
const CACHE = 'magazzino-v1';
const GUSCIO = ['/', '/static/css/style.css', '/static/js/app.js', '/static/js/grafici.js', '/static/js/targa.js', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(GUSCIO)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((n) => n !== CACHE).map((n) => caches.delete(n)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request).then((r) => {
      if (r.ok && (url.pathname === '/' || url.pathname.startsWith('/static/') || url.pathname === '/manifest.webmanifest')) {
        const copia = r.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copia)).catch(() => {});
      }
      return r;
    }).catch(() => caches.match(e.request).then((r) => r || (e.request.mode === 'navigate' ? caches.match('/') : undefined)))
  );
});
