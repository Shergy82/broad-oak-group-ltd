/* public/firebase-messaging-sw.js */
/* Stable Web Push service worker (no Firebase SDK) */

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

function safeJsonParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function pickPayload(event) {
  if (!event.data) return null;

  try {
    return event.data.json();
  } catch {
    const txt = event.data.text();
    return safeJsonParse(txt) || { body: txt };
  }
}

self.addEventListener('push', (event) => {
  const raw = pickPayload(event);
  if (!raw) return;

  const notif = raw.notification || {};
  const data = raw.data || {};

  const title =
    notif.title ||
    raw.title ||
    data.title ||
    'Notification';

  const body =
    notif.body ||
    raw.body ||
    data.body ||
    '';

  const icon =
    notif.icon ||
    raw.icon ||
    data.icon ||
    '/icon-192.png';

  const badge =
    raw.badge ||
    data.badge ||
    '/icon-192.png';

  const url =
    data.url ||
    raw.url ||
    '/';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge,
      data: { url },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = event.notification.data?.url || '/dashboard';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if (client.url === url && 'focus' in client) return client.focus();
        }
        return self.clients.openWindow ? self.clients.openWindow(url) : undefined;
      })
  );
});
