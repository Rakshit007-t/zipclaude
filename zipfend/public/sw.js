// Minimal service worker: makes the app installable and keeps the shell
// loading fast. API calls and try-on images always go to the network.
const CACHE_NAME = 'zipright-shell-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache cross-origin requests (backend API, fonts CDN handles itself)
  if (url.origin !== self.location.origin) return;
  // Never cache generated try-on images or anything non-GET
  if (event.request.method !== 'GET' || url.pathname.startsWith('/uploads')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || Response.error()))
  );
});
