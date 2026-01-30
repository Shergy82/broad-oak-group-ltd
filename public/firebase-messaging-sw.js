
// This file must be in the /public directory

// Give the service worker access to Firebase Messaging.
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

// Initialize the Firebase app in the service worker with your project's sender ID.
// This is the same config from your web app.
const firebaseConfig = {
  apiKey: "AIzaSyBEF3PmL0FyLmZTDXxx9qzeaolZXNt5Sn8",
  authDomain: "the-final-project-5e248.firebaseapp.com",
  projectId: "the-final-project-5e248",
  storageBucket: "the-final-project-5e248.appspot.com",
  messagingSenderId: "1075347108969",
  appId: "1:1075347108969:web:2e259a194a49d91bfcdef8",
};

firebase.initializeApp(firebaseConfig);

const messaging = firebase.messaging();

/**
 * The onBackgroundMessage handler is triggered when the app is in the background
 * or closed, and a notification is received.
 */
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  
  const notificationTitle = payload.notification?.title || 'New Notification';
  const notificationOptions = {
    body: payload.notification?.body || 'Something happened',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: payload.data || { url: '/' } // Pass along the data object
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

/**
 * This event is triggered when a user clicks on a notification.
 */
self.addEventListener('notificationclick', (event) => {
  console.log('[Service Worker] Notification click Received.');
  event.notification.close();

  const urlToOpen = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    }).then((clientList) => {
      // If a window for the app is already open, focus it.
      for (const client of clientList) {
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise, open a new window.
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
