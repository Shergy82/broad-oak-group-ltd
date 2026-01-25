
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getMessaging, getToken, isSupported as isMessagingSupported } from 'firebase/messaging';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import { useToast } from './use-toast';
import { useAuth } from './use-auth';

type Permission = NotificationPermission | 'default';

const LS_PUSH_ENABLED_KEY = 'push_enabled'; // persists the user's choice

function readPushEnabled(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    const v = window.localStorage.getItem(LS_PUSH_ENABLED_KEY);
    return v === 'true';
  } catch {
    return false;
  }
}

function writePushEnabled(val: boolean) {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(LS_PUSH_ENABLED_KEY, String(val));
  } catch {
    // ignore
  }
}

export function usePushNotifications() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [isSupported, setIsSupported] = useState(false);
  const [permission, setPermission] = useState<Permission>('default');
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState<boolean>(() => readPushEnabled());
  const [isKeyLoading, setIsKeyLoading] = useState(false); // VAPID key is now from env, so no loading needed.
  const [currentToken, setCurrentToken] = useState<string | null>(null);

  const vapidKey = useMemo(() => {
    return process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY || null;
  }, []);

  useEffect(() => {
    (async () => {
      const supported = await isMessagingSupported();
      setIsSupported(supported);
      if (supported && typeof window !== 'undefined' && 'Notification' in window) {
        setPermission(Notification.permission);
        if (readPushEnabled() && Notification.permission !== 'granted') {
          setIsSubscribed(false);
          writePushEnabled(false);
        }
      }
    })();
  }, []);
  
  const getAndSendToken = useCallback(async (enabled: boolean) => {
    if (!isSupported || !vapidKey) return;

    try {
      const messaging = getMessaging();
      const token = await getToken(messaging, { vapidKey });

      if (token) {
        setCurrentToken(token);
        const setNotificationStatus = httpsCallable(functions, 'setNotificationStatus');
        await setNotificationStatus({ enabled, token, platform: 'web' });
      } else if (enabled) {
        throw new Error('Failed to get FCM token.');
      }
    } catch (error) {
       console.error('An error occurred while getting token:', error);
       throw error;
    }
  }, [isSupported, vapidKey]);


  const subscribe = useCallback(async () => {
    setIsSubscribing(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') {
        throw new Error('Notification permission not granted.');
      }
      await getAndSendToken(true);
      setIsSubscribed(true);
      writePushEnabled(true);
      toast({ title: 'Subscribed', description: 'Push notifications are enabled.' });
    } catch (err: any) {
      console.error('Error subscribing:', err);
      toast({ title: 'Subscription Failed', description: err.message, variant: 'destructive' });
      setIsSubscribed(false);
      writePushEnabled(false);
    } finally {
      setIsSubscribing(false);
    }
  }, [getAndSendToken, toast]);


  const unsubscribe = useCallback(async () => {
    setIsSubscribing(true);
    try {
      if (currentToken) {
        const setNotificationStatus = httpsCallable(functions, 'setNotificationStatus');
        await setNotificationStatus({ enabled: false, token: currentToken });
      }
      setIsSubscribed(false);
      writePushEnabled(false);
      toast({ title: 'Unsubscribed', description: 'Push notifications disabled.' });
    } catch (err: any) {
      console.error('Error unsubscribing:', err);
      toast({ title: 'Unsubscribe Failed', description: err.message, variant: 'destructive' });
    } finally {
      setIsSubscribing(false);
    }
  }, [currentToken, toast]);

  const reset = useCallback(() => {
    setIsSubscribed(false);
    writePushEnabled(false);
    if(typeof window !== 'undefined' && 'Notification' in window) {
      setPermission(Notification.permission);
    }
  }, []);

  return {
    isSupported,
    isSubscribed,
    isSubscribing,
    isKeyLoading,
    vapidKey,
    permission,
    subscribe,
    unsubscribe,
    reset,
  };
}
