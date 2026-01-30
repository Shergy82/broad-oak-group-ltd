'use client';

import { useEffect } from 'react';

const SW_URL = '/firebase-messaging-sw.js';
const SW_SCOPE = '/';

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    (async () => {
      try {
        // If some other SW is registered, remove it (prevents “no active service worker” issues)
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const r of regs) {
          const url = r.active?.scriptURL || r.installing?.scriptURL || r.waiting?.scriptURL || '';
          if (url && !url.includes(SW_URL)) {
            await r.unregister();
          }
        }

        // Register the correct SW
        await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });

        // Ensure a controller exists (otherwise PushManager.subscribe can fail after refresh)
        if (!navigator.serviceWorker.controller) {
          await new Promise<void>((resolve) => {
            navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
          });
        }
      } catch (e) {
        // keep quiet; UI can show toast elsewhere if needed
        console.error('Service worker registration failed:', e);
      }
    })();
  }, []);

  return null;
}
