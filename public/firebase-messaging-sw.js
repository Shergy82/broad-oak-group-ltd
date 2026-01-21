/* firebase-messaging-sw.js
   No importScripts, no Firebase SDK.
   Handles Web Push payload directly.
*/

self.addEventListener('push', function (event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    try {
      data = event.data ? JSON.parse(event.data.text()) : {};
    } catch (e2) {
      data = {};
    }
  }

  // FCM may wrap payload
  var notification = data.notification || (data.data && data.data.notification) || {};
  var title = notification.title || data.title || 'Broad Oak Group';
  var body = notification.body || data.body || '';

  var options = {
    body: body,
    data: data.data || data || {},
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();

  var url = '/';
  try {
    if (event.notification && event.notification.data && event.notification.data.url) {
      url = event.notification.data.url;
    }
  } catch (e) {}

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientsArr) {
      for (var i = 0; i < clientsArr.length; i++) {
        var client = clientsArr[i];
        if (client && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
