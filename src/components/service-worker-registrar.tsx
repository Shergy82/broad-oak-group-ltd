'use client';

import { useEffect } from 'react';

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker
      .register('/firebase-messaging-sw.js')
      .then((registration) => {
        console.log('[SW] registered:', registration.scope);
      })
      .catch((error) => {
        console.error('[SW] registration failed:', error);
      });
  }, []);

  return null;
}
