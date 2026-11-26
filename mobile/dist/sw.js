const CACHE_NAME = 'pulsenote-offline-v10';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/icon.png',
  '/favicon.ico',
  '/_expo/static/js/web/index-2d34f55100caac7ed1b9f9cb8bf8a74b.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Background Web Push Wake-Up Handler: Wakes up the phone even when the screen is locked and app is closed!
self.addEventListener('push', (event) => {
  let data = {
    title: '⏰ PulseNote Alarm Ringing!',
    body: 'Tap to open, snooze, or complete your scheduled task!'
  };
  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch (e) {}

  event.waitUntil(
    self.registration.showNotification(data.title || '⏰ PulseNote Alarm', {
      body: data.body || 'Tap to view alarm',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      vibrate: [500, 250, 500, 250, 500, 250, 800],
      requireInteraction: true,
      renotify: true,
      tag: `pulsenote_alarm_${data.reminderId || Date.now()}`,
      actions: [
        { action: 'open', title: '⏰ Open & Dismiss Alarm' }
      ],
      data
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/');
    })
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (url.pathname.startsWith('/api/')) {
    return;
  }

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (req.method === 'GET' && res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((cached) => cached || caches.match('/index.html'))
      )
  );
});
