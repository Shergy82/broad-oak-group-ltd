/* eslint-disable no-undef */
/* firebase-messaging-sw.js */

/**
 * NOTE:
 * This file must be plain JS and must live in /public so it is served at:
 * https://YOUR_DOMAIN/firebase-messaging-sw.js
 *
 * It must NOT use ES module imports.
 */

// Use Firebase compat libraries in service worker
importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js');

// Your Firebase web app config (same values as your client config)
firebase.initializeApp({
  apiKey: "AIzaSyBEF3PmL0FyLmZTDXxx9qzeaolZXNt5Sn8",
  authDomain: "the-final-project-5e248.firebaseapp.com",
  projectId: "the-final-project-5e248",
  storageBucket: "the-final-project-5e248.appspot.com",
  messagingSenderId: "1075347108969",
  appId: "1:1075347108969:web:2e259a194a49d91bfcdef8",
});

// Retrieve firebase messaging instance
const messaging = firebase.messaging();

// Optional: show notifications when a push arrives while app is in background
messaging.onBackgroundMessage((payload) => {
  // You can customize this, but keep it safe if payload fields are missing.
  const title = payload?.notification?.title || 'Broad Oak Group';
  const options = {
    body: payload?.notification?.body || '',
    icon: '/icons/icon-192.png', // adjust if your icon path differs
    data: payload?.data || {},
  };

  self.registration.showNotification(title, options);
});

// Optional: handle clicks
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});
