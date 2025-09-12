
'use client';

import { useState, useEffect, useCallback } from 'react';
import { db, functions, httpsCallable, isFirebaseConfigured } from '@/lib/firebase';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { collection, doc, setDoc, deleteDoc } from 'firebase/firestore';

// Function to convert VAPID public key
function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export type PermissionState = 'prompt' | 'granted' | 'denied';

export function usePushNotifications() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [vapidKey, setVapidKey] = useState<string | null>(null);
  const [permission, setPermission] = useState<PermissionState | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window) {
      setIsSupported(true);
      setPermission(Notification.permission as PermissionState);
    }
  }, []);

  // Step 1: Fetch VAPID key once supported.
  useEffect(() => {
    async function fetchVapidKey() {
      if (!isSupported || !isFirebaseConfigured || !functions) return;
      try {
        const getVapidPublicKey = httpsCallable<{ }, { publicKey: string }>(functions, 'getVapidPublicKey');
        const result = await getVapidPublicKey();
        setVapidKey(result.data.publicKey);
      } catch (error: any) {
        console.error('Could not get VAPID public key from server:', error);
        let description = 'Could not connect to the push notification service. Please try again later.';
        
        if (error.code === 'not-found') {
          description = 'The backend notification service has not been deployed yet. The account owner can find setup instructions in the Admin panel.';
        }
        
        toast({
            variant: 'destructive',
            title: 'Notification Service Unavailable',
            description: description,
            duration: 15000,
        })
      }
    }
    fetchVapidKey();
  }, [isSupported, toast]);
  
  // Step 2: Check for subscription only AFTER user and VAPID key are available.
  useEffect(() => {
    const checkSubscription = async () => {
      if (!isSupported || !user || !vapidKey) return;
      
      const swRegistration = await navigator.serviceWorker.ready;
      try {
        const subscription = await swRegistration.pushManager.getSubscription();
        setIsSubscribed(!!subscription);
      } catch (e) {
        console.error("Error getting subscription", e);
        setIsSubscribed(false);
      }
    };

    checkSubscription();
  }, [isSupported, user, vapidKey]);

  const subscribe = useCallback(async () => {
    if (!isSupported || !user || !vapidKey) {
        toast({ variant: 'destructive', title: 'Error', description: 'Push notifications are not supported or not configured.'});
        return;
    };
    
    if (permission === 'denied') {
        toast({ variant: 'destructive', title: 'Permission Denied', description: 'Please enable notifications in your browser settings.'});
        return;
    }

    setIsSubscribing(true);

    try {
      const swRegistration = await navigator.serviceWorker.ready;
      const applicationServerKey = urlBase64ToUint8Array(vapidKey);
      const subscription = await swRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });

      setPermission(Notification.permission as PermissionState);
      
      const subscriptionJson = subscription.toJSON();
      if (!subscriptionJson.endpoint) {
          throw new Error("Subscription endpoint is null");
      }
      if (!db) throw new Error("Firestore is not initialized");

      await setDoc(doc(db, `users/${user.uid}/pushSubscriptions`, btoa(subscriptionJson.endpoint)), subscriptionJson);

      setIsSubscribed(true);
      toast({
        title: 'Subscribed!',
        description: 'You will now receive notifications about your shifts.',
      });
    } catch (error: any) {
        console.error('Error subscribing to push notifications:', error);
        setPermission(Notification.permission as PermissionState);
        setIsSubscribed(false);
        if (error.name === 'NotAllowedError') {
             toast({ variant: 'destructive', title: 'Subscription Blocked', description: 'You denied the notification permission. To enable it, please go to your browser settings.' });
        } else {
             toast({ variant: 'destructive', title: 'Subscription Failed', description: 'An unexpected error occurred.' });
        }
    } finally {
        setIsSubscribing(false);
    }
  }, [isSupported, user, vapidKey, toast, permission]);

  const unsubscribe = useCallback(async () => {
    if (!isSupported || !user) return;
    setIsSubscribing(true);

    try {
      const swRegistration = await navigator.serviceWorker.ready;
      const subscription = await swRegistration.pushManager.getSubscription();

      if (subscription) {
        await subscription.unsubscribe();
        if (!db) throw new Error("Firestore is not initialized");
        
        const endpointB64 = btoa(subscription.endpoint);
        await deleteDoc(doc(db, `users/${user.uid}/pushSubscriptions`, endpointB64));
      }
      setIsSubscribed(false);
      setPermission('prompt');
      toast({
        title: 'Unsubscribed',
        description: 'You will no longer receive notifications.',
      });
    } catch (error) {
      console.error('Error unsubscribing:', error);
      toast({ variant: 'destructive', title: 'Unsubscribe Failed', description: 'Could not unsubscribe. Please try again.' });
    } finally {
        setIsSubscribing(false);
    }
  }, [isSupported, user, toast]);

  return { isSupported, isSubscribed, isSubscribing, permission, subscribe, unsubscribe };
}
