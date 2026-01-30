
// This service worker handles incoming push notifications.

// Note: This file does NOT import the Firebase SDK. It's a standard service worker.

self.addEventListener('push', function(event) {
  console.log('[Service Worker] Push Received.');
  
  let data = {};
  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch (e) {
    console.error('[Service Worker] Failed to parse push data:', e);
  }

  const title = data.title || 'Broad Oak Group';
  const options = {
    body: data.body || 'You have a new update.',
    icon: '/icon-192.png', // Main icon for the notification
    badge: '/icon-72.png', // Small icon, often shown on the status bar (Android)
    data: {
      url: data.url || '/' // URL to open when the notification is clicked
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(event) {
  console.log('[Service Worker] Notification click Received.');

  event.notification.close();

  // This looks at the `data.url` passed in the options object above.
  const urlToOpen = event.notification.data.url || '/';

  event.waitUntil(
    clients.matchAll({
      type: 'window'
    }).then(function(clientList) {
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
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
