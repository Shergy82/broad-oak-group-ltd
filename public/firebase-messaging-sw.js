// This service worker is essential for receiving and displaying push notifications,
// especially when the app is in the background or closed.

// This event is triggered when a push message is received.
self.addEventListener('push', (event) => {
  console.log('[Service Worker] Push Received.');
  if (!event.data) {
    console.error('[Service Worker] Push event but no data');
    return;
  }

  let payload;
  try {
    payload = event.data.json();
  } catch (e) {
    console.error('[Service Worker] Could not parse push data as JSON.', e);
    // If it's not JSON, maybe it's just a string.
    payload = { body: event.data.text() };
  }

  const title = payload.title || 'New Notification';
  const options = {
    body: payload.body || 'You have a new message.',
    icon: payload.icon || '/icon-192.png', // Default icon
    badge: payload.badge || '/badge-72.png', // A smaller icon for the notification tray
    data: {
      url: payload.url || '/', // The URL to open when the notification is clicked
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// This event is triggered when a user clicks on a notification.
self.addEventListener('notificationclick', (event) => {
  console.log('[Service Worker] Notification click Received.');
  event.notification.close(); // Close the notification

  const urlToOpen = event.notification.data.url || '/';

  // This looks for an existing window/tab with the same URL and focuses it.
  // If not found, it opens a new window/tab.
  event.waitUntil(
    clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    }).then((clientList) => {
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        // Check if the client's URL is the one we want to open.
        // The URL might have extra query params, so we check if it starts with the base URL.
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
