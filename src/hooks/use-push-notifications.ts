
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { db, functions, httpsCallable, firebaseConfig, isFirebaseConfigured } from '@/lib/firebase';
import { isSupported as isFirebaseMessagingSupported } from "firebase/messaging";
import { collection, getDocs, deleteDoc } from 'firebase/firestore';


function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}


export function usePushNotifications() {
  const { toast } = useToast();
  const { user } = useAuth();

  const [isSupported, setIsSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isKeyLoading, setIsKeyLoading] = useState(true);
  const [vapidKey, setVapidKey] = useState<string | null>(null);

  useEffect(() => {
    async function checkSupportAndKey() {
      if (!isFirebaseConfigured || typeof window === 'undefined') {
        setIsSupported(false);
        setIsKeyLoading(false);
        return;
      }
      
      const supported = await isFirebaseMessagingSupported();
      setIsSupported(supported);

      if (supported) {
        setPermission(Notification.permission);
        
        const key = firebaseConfig.vapidKey;
        if (key) {
          setVapidKey(key);
        } else {
          console.error('VAPID public key is not configured in src/lib/firebase.ts.');
        }
        setIsKeyLoading(false);

      } else {
        setIsKeyLoading(false);
      }
    }
    checkSupportAndKey();
  }, []);
  
  useEffect(() => {
    (async () => {
        if(isSupported && user) {
            const reg = await navigator.serviceWorker.ready;
            const sub = await reg.pushManager.getSubscription();
            setIsSubscribed(!!sub);
        }
    })();
  }, [isSupported, user]);

  const subscribe = useCallback(async () => {
    setIsSubscribing(true);

    if (!isSupported || !user || !vapidKey) {
      toast({ title: 'Cannot Subscribe', description: 'Push notifications are not fully configured or supported.', variant: 'destructive' });
      setIsSubscribing(false);
      return;
    }

    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') throw new Error('Permission not granted.');
      
      const swRegistration = await navigator.serviceWorker.ready;
      const appServerKey = urlBase64ToUint8Array(vapidKey);
      
      const subscription = await swRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: appServerKey,
      });

      if (!subscription) throw new Error('Failed to get browser subscription.');
      
      const setNotificationStatus = httpsCallable('setNotificationStatus');
      await setNotificationStatus({ enabled: true, subscription: subscription.toJSON() });
      
      setIsSubscribed(true);
      toast({ title: 'Subscribed!', description: 'You will now receive notifications.' });
    } catch (err: any) {
       toast({
        title: 'Subscription Failed',
        description: err.message || 'An unexpected error occurred.',
        variant: 'destructive',
      });
    } finally {
      setIsSubscribing(false);
    }
  }, [isSupported, user, vapidKey, toast]);

  const unsubscribe = useCallback(async () => {
    setIsSubscribing(true);
    if (!user || !functions) {
      setIsSubscribing(false);
      return;
    }

    try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
            await sub.unsubscribe();
        }

      const setNotificationStatus = httpsCallable('setNotificationStatus');
      await setNotificationStatus({ enabled: false });

      setIsSubscribed(false);
      toast({ title: 'Unsubscribed', description: 'You will no longer receive notifications.' });
    } catch (err: any) {
      toast({
        title: 'Unsubscribe Failed',
        description: err.message || 'An unexpected error occurred.',
        variant: 'destructive',
      });
    } finally {
      setIsSubscribing(false);
    }
  }, [user, toast]);

  return {
    isSupported,
    isSubscribed,
    isSubscribing,
    permission,
    isKeyLoading,
    vapidKey,
    subscribe,
    unsubscribe,
  };
}
