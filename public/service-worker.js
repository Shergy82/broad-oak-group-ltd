
// This file must be in the public folder.

self.addEventListener('push', (event) => {
  if (!event.data) {
    console.error('Push event but no data');
    return;
  }

  const data = event.data.json();
  const options = {
    body: data.body,
    icon: '/logo-192.png', // You can add a 192x192 icon in your /public folder
    badge: '/logo-72.png', // And a 72x72 badge
    data: {
      url: data.data.url, // URL to open on click
    },
  };
  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = new URL(event.notification.data.url, self.location.origin).href;
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Check if there is already a window/tab open with the target URL
      let matchingClient = windowClients.find((client) => client.url === urlToOpen);

      // If so, focus it.
      if (matchingClient) {
        return matchingClient.focus();
      }
      // If not, open a new tab.
      return clients.openWindow(urlToOpen);
    })
  );
});
