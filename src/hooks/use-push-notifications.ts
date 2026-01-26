
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { functions, httpsCallable, isFirebaseConfigured } from '@/lib/firebase';
import { getMessaging, getToken, isSupported as isFirebaseMessagingSupported } from "firebase/messaging";

type Permission = NotificationPermission | 'default';

export function usePushNotifications() {
  const { toast } = useToast();
  const { user } = useAuth();

  const [isSupported, setIsSupported] = useState(false);
  const [permission, setPermission] = useState<Permission>('default');
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
        
        // Fetch VAPID key from backend
        try {
            const getVapidPublicKey = httpsCallable<{ }, { publicKey: string }>(functions, 'getVapidPublicKey');
            const result = await getVapidPublicKey();
            const key = result.data.publicKey;
            if (key) {
              setVapidKey(key);
            } else {
              throw new Error('VAPID public key is missing from server response.');
            }
        } catch (error) {
            console.error('Failed to fetch VAPID public key:', error);
            toast({ variant: 'destructive', title: 'Config Error', description: 'Could not fetch notification configuration.' });
        } finally {
            setIsKeyLoading(false);
        }
      } else {
        setIsKeyLoading(false);
      }
    }
    checkSupportAndKey();
  }, [toast]);
  
  useEffect(() => {
    // Check initial subscription state
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
      toast({ title: 'Cannot Subscribe', variant: 'destructive' });
      setIsSubscribing(false);
      return;
    }

    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') throw new Error('Permission not granted.');
      
      const messaging = getMessaging();
      const fcmToken = await getToken(messaging, { vapidKey });

      if (!fcmToken) throw new Error('Failed to retrieve FCM token.');

      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.getSubscription();
      if (!subscription) throw new Error('Failed to get browser subscription.');
      
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

      const setNotificationStatus = httpsCallable(functions, 'setNotificationStatus');
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
