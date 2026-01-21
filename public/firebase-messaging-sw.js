/* firebase-messaging-sw.js (diagnostic) */

function swLog(msg) {
  try {
    // This will show in chrome://serviceworker-internals and DevTools SW console
    console.log('[SW]', msg);
  } catch (e) {}
}

swLog('starting');

try {
  importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js');
  swLog('firebase-app-compat loaded');

  importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js');
  swLog('firebase-messaging-compat loaded');
} catch (e) {
  swLog('importScripts failed: ' + (e && e.message ? e.message : String(e)));
  throw e;
}

try {
  firebase.initializeApp({
    apiKey: "AIzaSyBEF3PmL0FyLmZTDXxx9qzeaolZXNt5Sn8",
    authDomain: "the-final-project-5e248.firebaseapp.com",
    projectId: "the-final-project-5e248",
    storageBucket: "the-final-project-5e248.appspot.com",
    messagingSenderId: "1075347108969",
    appId: "1:1075347108969:web:2e259a194a49d91bfcdef8"
  });
  swLog('firebase.initializeApp ok');
} catch (e2) {
  swLog('initializeApp failed: ' + (e2 && e2.message ? e2.message : String(e2)));
  throw e2;
}

var messaging;
try {
  messaging = firebase.messaging();
  swLog('firebase.messaging() ok');
} catch (e3) {
  swLog('firebase.messaging() failed: ' + (e3 && e3.message ? e3.message : String(e3)));
  throw e3;
}

try {
  messaging.onBackgroundMessage(function (payload) {
    var notification = (payload && payload.notification) ? payload.notification : {};
    var title = notification.title || 'Broad Oak Group';
    var options = { body: notification.body || '' };
    self.registration.showNotification(title, options);
  });
  swLog('onBackgroundMessage handler set');
} catch (e4) {
  swLog('onBackgroundMessage failed: ' + (e4 && e4.message ? e4.message : String(e4)));
  throw e4;
}
