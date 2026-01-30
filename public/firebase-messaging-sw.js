// This file MUST be in the /public folder

// We need to import the firebase app and messaging modules
// but since this is a service worker, we have to use importScripts
importScripts('https://www.gstatic.com/firebasejs/9.15.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.15.0/firebase-messaging-compat.js');

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBEF3PmL0FyLmZTDXxx9qzeaolZXNt5Sn8",
  authDomain: "the-final-project-5e248.firebaseapp.com",
  projectId: "the-final-project-5e248",
  storageBucket: "the-final-project-5e248.appspot.com",
  messagingSenderId: "1075347108969",
  appId: "1:1075347108969:web:2e259a194a49d91bfcdef8"
};


// Initialize Firebase
const app = firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// This is the magic that listens for messages when the app is in the background
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);

  // Customize notification here
  const notificationTitle = payload.data.title || 'New Notification';
  const notificationOptions = {
    body: payload.data.body || 'Something happened!',
    icon: '/icon-192.png',
    data: {
        url: payload.data.url || '/'
    }
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});


// When a notification is clicked, open the app
self.addEventListener('notificationclick', (event) => {
  event.notification.close(); // Close the notification

  const urlToOpen = event.notification.data.url || '/';

  event.waitUntil(
    clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    }).then((clientList) => {
      // If a window for this app is already open, focus it
      for (const client of clientList) {
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise, open a new window
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
