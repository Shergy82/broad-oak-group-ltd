/* firebase-messaging-sw.js */
/* Debug version: logs import errors clearly */

(function () {
  try {
    importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js');
    importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js');
  } catch (e) {
    // This will surface as a clearer failure reason in DevTools
    self.registration && self.registration.showNotification
      ? self.registration.showNotification('SW importScripts failed', { body: String(e) })
      : null;
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

    var messaging = firebase.messaging();

    messaging.onBackgroundMessage(function (payload) {
      var notification = (payload && payload.notification) ? payload.notification : {};
      var data = (payload && payload.data) ? payload.data : {};

      var title = notification.title || 'Broad Oak Group';
      var options = {
        body: notification.body || '',
        data: data
      };

      self.registration.showNotification(title, options);
    });
  } catch (e2) {
    throw e2;
  }
})();
