
'use client';

import { useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';

export function ServiceWorkerRegistrar() {
  const { toast } = useToast();

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker
          .register('/service-worker.js')
          .then((registration) => {
            console.log('ServiceWorker registration successful with scope: ', registration.scope);
          })
          .catch((error) => {
            console.error('ServiceWorker registration failed: ', error);
            toast({
              variant: 'destructive',
              title: 'Service Worker Failed',
              description: 'The app may not work offline or receive notifications.',
            });
          });
      });
    }
  }, [toast]);

  return null;
}
