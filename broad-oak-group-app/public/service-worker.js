'use strict';

self.addEventListener('push', function(event) {
  if (!event.data) {
    console.error('Push event but no data');
    return;
  }
  const data = event.data.json();
  const options = {
    body: data.body,
    icon: '/icon-192.png', // Reference icons from the public folder
    badge: '/icon-192.png',
    data: {
      url: data.data.url || '/'
    }
  };
  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  const targetUrl = event.notification.data.url;

  event.waitUntil(
    clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    }).then(function(clientList) {
      // Check if there's already a window open with the target URL
      for (const client of clientList) {
        if (client.url === targetUrl && 'focus' in client) {
          return client.focus();
        }
      }
      // If not, open a new window
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
