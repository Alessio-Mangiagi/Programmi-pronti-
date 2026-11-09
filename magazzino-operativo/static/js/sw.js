// "><(((º> sabusabu <º)))><"
// Service worker minimo: rende l'app installabile sul telefono e tiene una copia
// della pagina e degli script per aprirla anche senza rete. Strategia "prima la
// rete": si usa la cache solo se il server non risponde, così gli aggiornamenti
// arrivano subito. Le API non vengono mai messe in cache.
// BASE = cartella da cui è servito questo file: "/" quando il Magazzino è aperto da solo,
// "/magazzino/" dentro il programma unico "DDT e Magazzino" (il Lettore DDT lo inoltra lì).
// Così lo stesso file vale nei due casi e non tocca mai le pagine del Lettore DDT.
const BASE = new URL('./', self.location).pathname;
const CACHE = 'magazzino-v2';
const GUSCIO = [BASE, BASE + 'static/css/style.css', BASE + 'static/js/app.js', BASE + 'static/js/grafici.js',
  BASE + 'static/js/targa.js', BASE + 'manifest.webmanifest'];

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
  if (e.request.method !== 'GET' || url.origin !== location.origin || !url.pathname.startsWith(BASE)
      || url.pathname.startsWith(BASE + 'api/')) return;
  e.respondWith(
    fetch(e.request).then((r) => {
      if (r.ok && (url.pathname === BASE || url.pathname.startsWith(BASE + 'static/') || url.pathname === BASE + 'manifest.webmanifest')) {
        const copia = r.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copia)).catch(() => {});
      }
      return r;
    }).catch(() => caches.match(e.request).then((r) => r || (e.request.mode === 'navigate' ? caches.match(BASE) : undefined)))
  );
});
