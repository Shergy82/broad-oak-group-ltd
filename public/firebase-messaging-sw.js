/* public/firebase-messaging-sw.js */
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyBEF3PmL0FyLmZTDXxx9qzeaolZXNt5Sn8",
  authDomain: "the-final-project-5e248.firebaseapp.com",
  projectId: "the-final-project-5e248",
  storageBucket: "the-final-project-5e248.firebasestorage.app",
  messagingSenderId: "1075347108969",
  appId: "1:1075347108969:web:2e259a194a49d91bfcdef8",
});

const messaging = firebase.messaging();

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || payload.data?.title || 'Broad Oak Group';
  const body  = payload.notification?.body  || payload.data?.body  || '';
  const url   = payload.data?.url || payload.fcmOptions?.link || '/';

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
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((arr) => {
      for (const c of arr) {
        if ('focus' in c) return c.focus().then(() => c.navigate(url));
      }
      return clients.openWindow(url);
    })
  );
});
