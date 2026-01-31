'use client';

import { useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';

const SW_URL = '/firebase-messaging-sw.js';
const SW_SCOPE = '/';

function isFcmSw(scriptURL?: string) {
  return !!scriptURL && scriptURL.includes('firebase-messaging-sw.js');
}

export function ServiceWorkerRegistrar() {
  const { toast } = useToast();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    let cancelled = false;

    const run = async () => {
      try {
        // 1) Remove any non-FCM service workers (like /service-worker.js)
        const regs = await navigator.serviceWorker.getRegistrations();

        let hasFcm = false;

        await Promise.all(
          regs.map(async (reg) => {
            const url =
              (reg as any)?.active?.scriptURL ||
              (reg as any)?.waiting?.scriptURL ||
              (reg as any)?.installing?.scriptURL ||
              '';

            if (isFcmSw(url)) {
              hasFcm = true;
              return;
            }

            try {
              await reg.unregister();
            } catch {
              // ignore
            }
          })
        );

        // 2) Ensure firebase-messaging-sw.js is registered
        if (!hasFcm) {
          await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
        }

        const readyReg = await navigator.serviceWorker.ready;

        if (!cancelled) {
          console.log('ServiceWorker ready with scope:', readyReg.scope);
        }
      } catch (error) {
        console.error('ServiceWorker registration failed:', error);
        if (!cancelled) {
          toast({
            variant: 'destructive',
            title: 'Service Worker Failed',
            description: 'The app may not receive notifications. Please refresh and try again.',
          });
        }
      }
    };

    // run immediately
    run();
    // plus a fallback after load
    window.addEventListener('load', run);

    return () => {
      cancelled = true;
      window.removeEventListener('load', run);
    };
  }, [toast]);

  return null;
}
