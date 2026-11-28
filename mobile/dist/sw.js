const CACHE_NAME = 'pulsenote-offline-v14';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/icon.png',
  '/favicon.ico',
  '/_expo/static/js/web/index-60d17d09ffe30cd26fc311dd073f45b1.js'
];

const scheduledTimers = new Map();

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

// Receive synced reminders from the app and schedule background Service Worker timers + OS Notification Triggers
self.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg || msg.type !== 'SYNC_REMINDERS' || !Array.isArray(msg.reminders)) return;

  for (const [, timerId] of scheduledTimers.entries()) {
    clearTimeout(timerId);
  }
  scheduledTimers.clear();

  const now = Date.now();
  for (const rem of msg.reminders) {
    if (rem.status !== 'pending' && rem.status !== 'snoozed') continue;
    const dueTime = new Date(rem.scheduled_at).getTime();
    const delayMs = dueTime - now;
    if (delayMs <= 0 || delayMs > 24 * 60 * 60 * 1000) continue;

    // 1. If device supports Chromium TimestampTrigger (OS-scheduled offline notifications)
    if ('showTrigger' in Notification.prototype && typeof TimestampTrigger !== 'undefined') {
      try {
        self.registration.showNotification(`⏰ PulseNote Alarm: ${rem.title}`, {
          body: rem.raw_input || 'Time to complete your scheduled task!',
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          tag: `pulsenote_alarm_${rem.id}`,
          showTrigger: new TimestampTrigger(dueTime),
          vibrate: [500, 250, 500, 250, 500, 250, 800],
          requireInteraction: true,
          actions: [
            { action: 'complete', title: '✅ Mark Done' },
            { action: 'snooze_10', title: '💤 Snooze 10m' }
          ],
          data: { reminderId: rem.id }
        });
      } catch (e) {}
    }

    // 2. Schedule Service Worker background timeout (fires while SW stays alive in background)
    const timerId = setTimeout(() => {
      self.registration.showNotification(`⏰ PulseNote Alarm: ${rem.title}`, {
        body: rem.raw_input || 'Tap to open, snooze, or complete your task!',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        vibrate: [500, 250, 500, 250, 500, 250, 800],
        requireInteraction: true,
        renotify: true,
        tag: `pulsenote_alarm_${rem.id}`,
        actions: [
          { action: 'complete', title: '✅ Mark Done' },
          { action: 'snooze_10', title: '💤 Snooze 10m' }
        ],
        data: { reminderId: rem.id }
      }).catch(() => {});
    }, delayMs);

    scheduledTimers.set(rem.id, timerId);
  }
});

// Background Web Push Wake-Up Handler: Wakes up the phone via FCM/APNs even when screen is locked and app is closed!
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
        { action: 'complete', title: '✅ Mark Done' },
        { action: 'snooze_10', title: '💤 Snooze 10m' }
      ],
      data
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  const action = event.action;
  const data = event.notification.data || {};
  event.notification.close();

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (action && data.reminderId) {
          client.postMessage({
            type: 'NOTIFICATION_ACTION',
            action,
            reminderId: data.reminderId
          });
        }
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
