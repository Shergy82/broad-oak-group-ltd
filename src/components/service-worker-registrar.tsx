'use client';

import { useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';

const SERVICE_WORKER_URL = '/firebase-messaging-sw.js';

export function ServiceWorkerRegistrar() {
  const { toast } = useToast();

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      console.warn('Service workers are not supported in this browser.');
      return;
    }

    (async () => {
      try {
        const registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL);
        console.log('Service Worker registered with scope:', registration.scope);
      } catch (error) {
        console.error('Service Worker registration failed:', error);
        toast({
          variant: 'destructive',
          title: 'Service Worker Error',
          description: 'Could not register the notification service.',
        });
      }
    })();
  }, [toast]);

  return null;
}
