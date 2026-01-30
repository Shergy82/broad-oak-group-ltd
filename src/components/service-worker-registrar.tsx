'use client';

import { useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { firebaseConfig } from '@/lib/firebase';

export function ServiceWorkerRegistrar() {
  const { toast } = useToast();

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    const registerServiceWorker = async () => {
      try {
        // Pass firebase config to the service worker via query params
        const config = JSON.stringify(firebaseConfig);
        const swUrl = `/firebase-messaging-sw.js?firebaseConfig=${encodeURIComponent(config)}`;
        
        const registration = await navigator.serviceWorker.register(swUrl, { scope: '/' });
        console.log('Service Worker registered successfully with scope:', registration.scope);
      } catch (error) {
        console.error('Service Worker registration failed:', error);
        toast({
          variant: 'destructive',
          title: 'Service Worker Failed',
          description: 'Could not set up notifications. Please refresh and try again.',
        });
      }
    };
    
    // Use the load event to ensure the page is fully loaded before registering
    window.addEventListener('load', registerServiceWorker);

    return () => {
        window.removeEventListener('load', registerServiceWorker);
    };

  }, [toast]);

  return null;
}
