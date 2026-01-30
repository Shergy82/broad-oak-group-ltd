
// This service worker handles receiving push notifications.

self.addEventListener('push', (event) => {
  if (!event.data) {
    console.error('Push event but no data');
    return;
  }

  const data = event.data.json();

  const title = data.title || 'New Notification';
  const options = {
    body: data.body || 'Something has happened!',
    icon: '/icon-192.png', // Main icon
    badge: '/icon-192.png', // Small monochrome icon for notification bar
    data: {
      url: data.url || '/',
    },
  };

  const notificationPromise = self.registration.showNotification(title, options);
  event.waitUntil(notificationPromise);
});

self.addEventListener('notificationclick', (event) => {
  // Close the notification pop-up
  event.notification.close();

  const urlToOpen = event.notification.data.url;

  // Open the app/url.
  const promiseChain = clients.matchAll({
    type: 'window',
    includeUncontrolled: true
  }).then((windowClients) => {
    let matchingClient = null;
    for (let i = 0; i < windowClients.length; i++) {
        const windowClient = windowClients[i];
        if (windowClient.url === urlToOpen) {
            matchingClient = windowClient;
            break;
        }
    }

    if (matchingClient) {
        return matchingClient.focus();
    } else {
        return clients.openWindow(urlToOpen);
    }
  });

  event.waitUntil(promiseChain);
});
