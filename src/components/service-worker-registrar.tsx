'use client';

import { useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';

export function ServiceWorkerRegistrar() {
  const { toast } = useToast();

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    // Register ASAP, do NOT wait for window "load"
    (async () => {
      try {
        const reg = await navigator.serviceWorker.register('/service-worker.js');
        console.log('ServiceWorker registration successful with scope:', reg.scope);
      } catch (error) {
        console.error('ServiceWorker registration failed:', error);
        toast({
          variant: 'destructive',
          title: 'Service Worker Failed',
          description: 'The app may not work offline or receive notifications.',
        });
      }
    })();
  }, [toast]);

  return null;
}
