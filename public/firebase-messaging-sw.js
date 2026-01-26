/* public/firebase-messaging-sw.js */

/* eslint-disable no-undef */
/* eslint-disable no-restricted-globals */

importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: "",
});

const messaging = firebase.messaging();

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

messaging.onBackgroundMessage((payload) => {
  const title =
    payload.notification?.title ||
    payload.data?.title ||
    'Broad Oak Group';

  const body =
    payload.notification?.body ||
    payload.data?.body ||
    '';

  const url =
    payload.data?.url ||
    payload.fcmOptions?.link ||
    '/';

  self.registration.showNotification(title, {
    body,
    data: { url },
    icon: '/logo192.png',
    badge: '/logo192.png',
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification?.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      for (const client of clientsArr) {
        if (client.url.includes(self.registration.scope) && 'focus' in client) {
          return client.focus().then(() => client.navigate(url));
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
