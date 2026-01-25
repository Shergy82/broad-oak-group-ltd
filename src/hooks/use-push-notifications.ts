
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { db, functions, httpsCallable, app } from '@/lib/firebase';
import {
  getMessaging,
  getToken,
  deleteToken,
  isSupported as isMessagingSupported,
} from 'firebase/messaging';

interface UsePushNotificationsReturn {
  isSupported: boolean;
  isSubscribed: boolean;
  isSubscribing: boolean;
  permission: NotificationPermission | 'unsupported';
  isKeyLoading: boolean;
  vapidKey: string | null;
  subscribe: () => Promise<void>;
  unsubscribe: () => Promise<void>;
  reset: () => void;
}

const SW_URL = '/firebase-messaging-sw.js';
const SW_SCOPE = '/';

function isFcmSwUrl(url: string | undefined | null) {
  return !!url && url.includes('firebase-messaging-sw.js');
}

export function usePushNotifications(): UsePushNotificationsReturn {
  const { toast } = useToast();
  const { user } = useAuth();

  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(
    typeof window === 'undefined' ? 'unsupported' : Notification.permission
  );
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isSubscribing, setIsSubscribing] = useState(false);

  const [isKeyLoading, setIsKeyLoading] = useState(true);
  const [vapidKey, setVapidKey] = useState<string | null>(null);

  const [currentToken, setCurrentToken] = useState<string | null>(null);

  const isSupported = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return 'serviceWorker' in navigator && 'Notification' in window;
  }, []);

  const ensureCorrectServiceWorker = useCallback(async (): Promise<ServiceWorkerRegistration> => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      throw new Error('Service workers not supported in this environment.');
    }

    const regs = await navigator.serviceWorker.getRegistrations();
    let fcmReg: ServiceWorkerRegistration | null = null;

    await Promise.all(
      regs.map(async (reg) => {
        const activeUrl =
          (reg as any)?.active?.scriptURL ||
          (reg as any)?.waiting?.scriptURL ||
          (reg as any)?.installing?.scriptURL ||
          '';

        if (isFcmSwUrl(activeUrl)) {
          fcmReg = reg;
          return;
        }

        try {
          await reg.unregister();
        } catch { /* ignore */ }
      })
    );

    if (!fcmReg) {
      fcmReg = await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
    }

    await navigator.serviceWorker.ready;

    if (!navigator.serviceWorker.controller) {
      console.log('[push] SW installed but page not yet controlled; reload may be required.');
    }

    return fcmReg;
  }, []);

  useEffect(() => {
    if (!isSupported) {
      setIsKeyLoading(false);
      return;
    }

    const envKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY?.trim() || '';
    if (envKey) {
      setVapidKey(envKey);
      setIsKeyLoading(false);
      return;
    }
    
    // Fallback to callable if env var is not set
    (async () => {
      try {
        if (!functions) {
          throw new Error('Firebase Functions not available.');
        }
        const getVapidPublicKey = httpsCallable<{}, { publicKey: string }>(functions, 'getVapidPublicKey');
        const result = await getVapidPublicKey();
        const key = result.data.publicKey?.trim();
        if (!key) throw new Error('VAPID public key is missing from server response.');
        setVapidKey(key);
      } catch (error: any) {
        console.error('Failed to fetch VAPID public key:', error);
      } finally {
        setIsKeyLoading(false);
      }
    })();
  }, [isSupported]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!isSupported || !user || isKeyLoading || !vapidKey?.trim()) return;

        const perm = Notification.permission;
        setPermission(perm);
        if (perm !== 'granted') {
          setIsSubscribed(false);
          return;
        }

        const fcmSupported = await isMessagingSupported().catch(() => false);
        if (!fcmSupported || !app) {
          setIsSubscribed(false);
          return;
        }

        const reg = await ensureCorrectServiceWorker();
        const messaging = getMessaging(app);

        const token = await getToken(messaging, { vapidKey: vapidKey.trim(), serviceWorkerRegistration: reg });

        if (cancelled) return;

        if (token) {
          setCurrentToken(token);
          setIsSubscribed(true);
        } else {
          setCurrentToken(null);
          setIsSubscribed(false);
        }
      } catch (err) {
        console.error('Error checking initial subscription status:', err);
        if (!cancelled) setIsSubscribed(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isSupported, user, vapidKey, isKeyLoading, ensureCorrectServiceWorker]);
  
  const reset = () => {
      setPermission(Notification.permission);
      setIsSubscribed(false);
      setCurrentToken(null);
  }

  const subscribe = useCallback(async () => {
    if (!user || !vapidKey?.trim() || !app || isSubscribing) return;

    setIsSubscribing(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);

      if (perm !== 'granted') {
        toast({ title: 'Permission denied', description: 'Notifications are blocked in your browser settings.' });
        return;
      }

      const fcmSupported = await isMessagingSupported().catch(() => false);
      if (!fcmSupported) {
        toast({ title: 'Unsupported', description: 'This browser/device does not support Firebase Messaging.', variant: 'destructive' });
        return;
      }
      
      const reg = await ensureCorrectServiceWorker();
      const messaging = getMessaging(app);

      const token = await getToken(messaging, { vapidKey: vapidKey.trim(), serviceWorkerRegistration: reg });
      if (!token) throw new Error('Failed to get an FCM token.');

      const setNotificationStatus = httpsCallable(functions, 'setNotificationStatus');
      await setNotificationStatus({ enabled: true, token, platform: 'web' });

      setCurrentToken(token);
      setIsSubscribed(true);
      toast({ title: 'Subscribed', description: 'Push notifications are now enabled.' });
    } catch (err: any) {
      console.error('Error subscribing to push notifications:', err);
      toast({ title: 'Subscription Failed', description: err?.message || 'An unexpected error occurred.', variant: 'destructive' });
      setIsSubscribed(false);
      setCurrentToken(null);
    } finally {
      setIsSubscribing(false);
    }
  }, [user, vapidKey, isSubscribing, toast, ensureCorrectServiceWorker]);

  const unsubscribe = useCallback(async () => {
    if (!user || !app || isSubscribing) return;
    
    setIsSubscribing(true);
    try {
      const fcmSupported = await isMessagingSupported().catch(() => false);
      if (fcmSupported) {
        const messaging = getMessaging(app);
        await deleteToken(messaging);
      }

      const setNotificationStatus = httpsCallable(functions, 'setNotificationStatus');
      await setNotificationStatus({ enabled: false, token: currentToken });

      setCurrentToken(null);
      setIsSubscribed(false);
      toast({ title: 'Unsubscribed', description: 'Push notifications have been disabled.' });
    } catch (err: any) {
      console.error('Error unsubscribing from push notifications:', err);
      toast({ title: 'Unsubscribe Failed', description: err?.message || 'An unexpected error occurred.', variant: 'destructive' });
    } finally {
      setIsSubscribing(false);
    }
  }, [user, currentToken, isSubscribing, toast]);

  return {
    isSupported,
    isSubscribed,
    isSubscribing,
    permission,
    isKeyLoading,
    vapidKey,
    subscribe,
    unsubscribe,
    reset,
  };
}
