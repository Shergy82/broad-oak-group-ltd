// This file MUST be in the public directory
importScripts('https://www.gstatic.com/firebasejs/9.2.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.2.0/firebase-messaging-compat.js');

// This config will be replaced by the values from your project's .env.local file
const firebaseConfig = {
  apiKey: '__NEXT_PUBLIC_FIREBASE_API_KEY__',
  authDomain: '__NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN__',
  projectId: '__NEXT_PUBLIC_FIREBASE_PROJECT_ID__',
  storageBucket: '__NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET__',
  messagingSenderId: '__NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID__',
  appId: '__NEXT_PUBLIC_FIREBASE_APP_ID__',
};

firebase.initializeApp(firebaseConfig);

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);

  const notificationTitle = payload.data.title || "New Notification";
  const notificationOptions = {
    body: payload.data.body || "",
    icon: payload.data.icon || '/icon-192.png',
    data: {
        url: payload.data.url || '/'
    }
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const urlToOpen = new URL(event.notification.data.url || '/', self.location.origin).href;

    event.waitUntil(
        self.clients.matchAll({
            type: 'window',
            includeUncontrolled: true,
        }).then((clientList) => {
            if (clientList.length > 0) {
                let client = clientList.find(c => c.url === urlToOpen && 'focus' in c);
                if (client) {
                    return client.focus();
                }
                if (clientList[0]) {
                     return clientList[0].navigate(urlToOpen).then(c => c.focus());
                }
            }
            return self.clients.openWindow(urlToOpen);
        })
    );
});
