/* public/firebase-messaging-sw.js */

importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

// 🔑 Firebase config — MUST match your app config
firebase.initializeApp({
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
});

// ✅ REQUIRED: initialise messaging in the SW
const messaging = firebase.messaging();

// 🔥 Force immediate activation
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// 📩 Handle background messages
messaging.onBackgroundMessage((payload) => {
  console.log('[SW] Background message received:', payload);

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

// 🖱️ Notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification?.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      for (const client of clientsArr) {
        if ('focus' in client) {
          client.focus();
          client.navigate(url);
          return;
        }
      }
      return clients.openWindow(url);
    })
  );
});
