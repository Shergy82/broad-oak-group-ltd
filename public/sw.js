// This service worker has been intentionally left blank to disable push notifications.
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // The service worker is active.
});
