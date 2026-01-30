
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
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
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
    async function fetchKey() {
      if (!functions) {
          setIsKeyLoading(false);
          return;
      };
      try {
        const getVapidPublicKeyFn = httpsCallable<{ }, { publicKey: string }>(functions, 'getVapidPublicKey');
        const result = await getVapidPublicKeyFn();
        setVapidKey(result.data.publicKey);
      } catch (error) {
        console.error("Failed to fetch VAPID public key:", error);
      } finally {
        setIsKeyLoading(false);
      }
    }
    if(isSupported) fetchKey();
  }, [isSupported]);

  useEffect(() => {
    async function checkSubscription() {
      if (!isSupported || !user) return;
      try {
          const registration = await navigator.serviceWorker.ready;
          const subscription = await registration.pushManager.getSubscription();
          setIsSubscribed(!!subscription);
      } catch (e) {
        console.error("Error checking push subscription status", e);
      }
    }
    checkSubscription();
  }, [isSupported, user]);

  const subscribe = useCallback(async () => {
    if (!isSupported || !user || !vapidKey || !functions) {
      toast({ title: 'Cannot Subscribe', description: 'System not ready.', variant: 'destructive' });
      return;
    }
    setIsSubscribing(true);
    try {
      const permissionResult = await Notification.requestPermission();
      setPermission(permissionResult);
      if (permissionResult !== 'granted') {
        throw new Error('Permission not granted for notifications.');
      }
      
      const registration = await navigator.serviceWorker.ready;
      const applicationServerKey = urlBase64ToUint8Array(vapidKey);
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });

      const setNotificationStatusFn = httpsCallable(functions, 'setNotificationStatus');
      await setNotificationStatusFn({ subscription: subscription.toJSON(), state: 'subscribe' });

      setIsSubscribed(true);
      toast({ title: 'Subscribed!', description: 'You will now receive notifications.' });
    } catch (error: any) {
      toast({ title: 'Subscription Failed', description: error.message, variant: 'destructive' });
    } finally {
      setIsSubscribing(false);
    }
  }, [isSupported, user, vapidKey, toast]);
  
  const unsubscribe = useCallback(async () => {
    if (!isSupported || !user || !functions) return;
    setIsSubscribing(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const setNotificationStatusFn = httpsCallable(functions, 'setNotificationStatus');
        await setNotificationStatusFn({ subscription: subscription.toJSON(), state: 'unsubscribe' });
        await subscription.unsubscribe();
      }
      setIsSubscribed(false);
      toast({ title: 'Unsubscribed', description: 'Push notifications disabled.' });
    } catch (error: any) {
      toast({ title: 'Unsubscribe Failed', description: error.message, variant: 'destructive' });
    } finally {
      setIsSubscribing(false);
    }
  }, [isSupported, user, toast]);

  return { isSupported, isSubscribed, isSubscribing, permission, isKeyLoading, vapidKey, subscribe, unsubscribe };
}
