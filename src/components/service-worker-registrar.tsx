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

    (async () => {
      try {
        // 1) Unregister any non-FCM service worker (e.g. /service-worker.js)
        const regs = await navigator.serviceWorker.getRegistrations();

        let hasFcmReg = false;

        await Promise.all(
          regs.map(async (reg) => {
            const scriptURL =
              (reg as any)?.active?.scriptURL ||
              (reg as any)?.waiting?.scriptURL ||
              (reg as any)?.installing?.scriptURL ||
              '';

            if (isFcmSw(scriptURL)) {
              hasFcmReg = true;
              return;
            }

            try {
              await reg.unregister();
            } catch {
              // ignore
            }
          })
        );

        // 2) Register the correct one if missing
        if (!hasFcmReg) {
          await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
        }

        // 3) Wait until ready
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
    })();

    return () => {
      cancelled = true;
    };
  }, [toast]);

  return null;
}
