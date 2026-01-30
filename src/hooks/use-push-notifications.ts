
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { functions, httpsCallable } from '@/lib/firebase';

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
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window) {
      setIsSupported(true);
      setPermission(Notification.permission);
    }
  }, []);

  useEffect(() => {
    async function fetchVapidKey() {
      if (!functions) {
          setIsKeyLoading(false);
          return;
      };
      try {
        const getVapidPublicKey = httpsCallable<{ }, { publicKey: string }>(functions, 'getVapidPublicKey');
        const result = await getVapidPublicKey();
        const key = result.data.publicKey;
        if (key) {
          setVapidKey(key);
        } else {
          throw new Error('VAPID public key is missing from server response.');
        }
      } catch (error: any) {
        console.error('Failed to fetch VAPID public key:', error);
      } finally {
        setIsKeyLoading(false);
      }
    }
    fetchVapidKey();
  }, []);
  
  useEffect(() => {
    const checkSubscription = async () => {
        if(isSupported && user) {
            try {
                const reg = await navigator.serviceWorker.ready;
                const sub = await reg.pushManager.getSubscription();
                setIsSubscribed(!!sub);
            } catch (e) {
                console.error("Error checking for push subscription:", e);
                setIsSubscribed(false);
            }
        }
    };
    checkSubscription();
  }, [isSupported, user]);

  const subscribe = useCallback(async () => {
    if (!isSupported || !user || !vapidKey || !functions) {
      toast({ title: 'Cannot Subscribe', description: 'System not ready or not logged in.', variant: 'destructive' });
      return;
    }
    setIsSubscribing(true);

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

      const setNotificationStatus = httpsCallable(functions, 'setNotificationStatus');
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
    if (!isSupported || !user || !functions) return;
    setIsSubscribing(true);

    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      const setNotificationStatus = httpsCallable(functions, 'setNotificationStatus');

      if (sub) {
        // Tell backend to remove this specific subscription
        await setNotificationStatus({ enabled: false, subscription: sub.toJSON() });
        await sub.unsubscribe();
      } else {
        // If no local subscription, still tell backend to disable notifications for the user
        await setNotificationStatus({ enabled: false });
      }

      setIsSubscribed(false);
      toast({ title: 'Unsubscribed', description: 'Push notifications have been disabled.' });
    } catch (err: any) {
      console.error('Error unsubscribing:', err);
      toast({
        title: 'Unsubscribe Failed',
        description: err.message || 'An unexpected error occurred.',
        variant: 'destructive',
      });
    } finally {
      setIsSubscribing(false);
    }
  }, [isSupported, user, toast]);

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
