
'use client';

import { useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';

export function ServiceWorkerRegistrar() {
  const { toast } = useToast();

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/service-worker.js')
        .then((registration) => {
          console.log('Service Worker registered with scope:', registration.scope);
        })
        .catch((error) => {
          console.error('Service Worker registration failed:', error);
          toast({
            variant: 'destructive',
            title: 'Service Worker Failed',
            description: 'Could not install the service worker, push notifications will not be available.',
          });
        });
    }
  }, [toast]);

  return null; // This component does not render anything
}
