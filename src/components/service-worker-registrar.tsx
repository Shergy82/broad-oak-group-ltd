'use client';

import { useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';

// This is the EXACT path to your service worker file in the `public` directory.
const SERVICE_WORKER_URL = '/firebase-messaging-sw.js';

export function ServiceWorkerRegistrar() {
  const { toast } = useToast();

  useEffect(() => {
    // Service workers are only available in the browser.
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      console.warn('Service workers are not supported in this browser.');
      return;
    }

    const registerServiceWorker = async () => {
      try {
        const registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL);
        console.log('Service Worker registered successfully with scope:', registration.scope);
      } catch (error) {
        console.error('Service Worker registration failed:', error);
        toast({
          variant: 'destructive',
          title: 'Service Worker Error',
          description: 'Could not register the notification service. Push notifications will not work.',
        });
      }
    };

    // We register the service worker after the page has loaded to avoid
    // delaying the initial render.
    window.addEventListener('load', registerServiceWorker);

    // Cleanup the event listener on component unmount.
    return () => window.removeEventListener('load', registerServiceWorker);
  }, [toast]);

  // This component does not render anything to the DOM.
  return null;
}
