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

// Web Push event listener
self.addEventListener('push', (event) => {
  let payload = { title: 'ZipRIGHT Notification', body: '' };
  try {
    if (event.data) {
      payload = event.data.json();
    }
  } catch (e) {
    if (event.data) {
      payload.body = event.data.text();
    }
  }
  const title = payload.title || 'ZipRIGHT Notification';
  const options = {
    body: payload.body || 'You have a new update from ZipRIGHT.',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    data: payload.url || '/'
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Notification click event listener
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url === targetUrl && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

