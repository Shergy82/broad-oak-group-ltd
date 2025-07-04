
// public/service-worker.js

self.addEventListener('install', () => {
  // Activate the new service worker as soon as it's installed.
  self.skipWaiting();
});

self.addEventListener('push', function (event) {
  if (!event.data) {
    console.log('Push event but no data');
    return;
  }
  const data = event.data.json();
  const options = {
    body: data.body,
    // Using a generic icon path. For a real app, ensure these files exist in /public
    icon: '/favicon.ico', 
    data: {
      url: data.data.url || '/',
    },
  };
  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();

  const urlToOpen = event.notification.data.url;

  // This focuses an existing tab if it's already open, or opens a new one.
  event.waitUntil(
    clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    }).then((windowClients) => {
      for (var i = 0; i < windowClients.length; i++) {
        var client = windowClients[i];
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
