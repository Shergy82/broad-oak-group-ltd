/* firebase-messaging-sw.js */
/* IMPORTANT: This must be plain JS (no ES modules, no TypeScript). */

importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyBEF3PmL0FyLmZTDXxx9qzeaolZXNt5Sn8",
  authDomain: "the-final-project-5e248.firebaseapp.com",
  projectId: "the-final-project-5e248",
  storageBucket: "the-final-project-5e248.appspot.com",
  messagingSenderId: "1075347108969",
  appId: "1:1075347108969:web:2e259a194a49d91bfcdef8",
});

const messaging = firebase.messaging();

// Optional: background notifications
messaging.onBackgroundMessage((payload) => {
  const title = payload?.notification?.title || 'Broad Oak Group';
  const options = {
    body: payload?.notification?.body || '',
    icon: '/icons/icon-192.png',
    data: payload?.data || {},
  };

  self.registration.showNotification(title, options);
});
