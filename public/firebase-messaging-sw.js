/* public/firebase-messaging-sw.js
   Handles push + click for web push notifications (FCM WebPush).
*/

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    try {
      payload = event.data ? JSON.parse(event.data.text()) : {};
    } catch {
      payload = {};
    }
  }

  const notification = payload.notification || payload.data?.notification || {};
  const title = notification.title || payload.title || 'Broad Oak Group';
  const body = notification.body || payload.body || '';

  // Prefer full URL if provided; fallback to root
  const url =
    (payload.data && (payload.data.url || payload.data.link)) ||
    payload.fcmOptions?.link ||
    '/';

  const options = {
    body,
    data: { url },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const urlToOpen = event.notification?.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // If already open, focus it and navigate
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          try {
            client.navigate(urlToOpen);
          } catch {}
          return;
        }
      }
      // Otherwise open a new window
      return clients.openWindow(urlToOpen);
    })
  );
});
