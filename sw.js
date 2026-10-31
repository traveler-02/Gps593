/* GPS 593 — service worker: red primero (siempre la versión nueva) y caché como respaldo sin internet */
const CACHE = 'gps593-v12';
const ASSETS = ['./', 'index.html', 'style.css', 'app.js', 'routing.js', 'offline.js', 'config.js', 'manifest.webmanifest',
  'icons/logo.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/favicon.png',
  'lib/leaflet.js', 'lib/leaflet.css', 'lib/pmtiles.js', 'lib/protomaps-leaflet.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;   // mapas, OSRM y Nominatim no se tocan
  const timeout = new Promise((_, rej) => setTimeout(rej, 4000));           // señal débil: tras 4 s usa la caché
  e.respondWith(
    Promise.race([fetch(e.request), timeout]).then(r => {
      const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});
