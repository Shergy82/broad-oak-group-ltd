'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { db, functions, httpsCallable, app } from '@/lib/firebase';
import { collection, deleteDoc, doc, getDocs, setDoc } from 'firebase/firestore';
import { getMessaging, getToken, deleteToken, isSupported as isMessagingSupported } from 'firebase/messaging';

interface UsePushNotificationsReturn {
  isSupported: boolean;
  isSubscribed: boolean;
  isSubscribing: boolean;
  permission: NotificationPermission | 'unsupported';
  isKeyLoading: boolean;
  vapidKey: string | null;
  subscribe: () => Promise<void>;
  unsubscribe: () => Promise<void>;
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

  // Support check (must include firebase messaging support)
  const isSupported = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return 'serviceWorker' in navigator && 'Notification' in window;
  }, []);

  // Fetch VAPID public key from env or backend callable
  useEffect(() => {
    if (!isSupported) {
      setIsKeyLoading(false);
      return;
    }

    const envKey =
      typeof process !== 'undefined' ? (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '').trim() : '';

    if (envKey) {
      setVapidKey(envKey);
      setIsKeyLoading(false);
      return;
    }

    async function fetchVapidKey() {
      if (!functions) {
        toast({ title: 'Functions not available', variant: 'destructive' });
        setIsKeyLoading(false);
        return;
      }
      try {
        const getVapidPublicKey = httpsCallable<{}, { publicKey: string }>(functions, 'getVapidPublicKey');
        const result = await getVapidPublicKey();
        const key = (result.data.publicKey ?? '').trim();
        if (!key) throw new Error('VAPID public key is missing from server response.');
        setVapidKey(key);
      } catch (error: any) {
        console.error('Failed to fetch VAPID public key:', error);
        toast({
          title: 'VAPID Key Error',
          description: error?.message || 'Failed to fetch VAPID key.',
          variant: 'destructive',
        });
      } finally {
        setIsKeyLoading(false);
      }
    }

    fetchVapidKey();
  }, [isSupported, toast]);

  // Helper: ensure token exists and is stored in Firestore
  const ensureTokenStored = useCallback(
    async (token: string) => {
      if (!user) return;
      const subsCol = collection(db, 'users', user.uid, 'pushSubscriptions');
      const tokenDoc = doc(subsCol, token);

      await setDoc(
        tokenDoc,
        {
          fcmToken: token,
          updatedAt: new Date().toISOString(),
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        },
        { merge: true }
      );
    },
    [user]
  );

  // On load: if already granted + we have vapidKey, try to get token and mark subscribed
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        if (!isSupported || !user) return;
        if (!vapidKey || isKeyLoading) return;
        if (Notification.permission !== 'granted') {
          if (!cancelled) setIsSubscribed(false);
          return;
        }

        const supported = await isMessagingSupported().catch(() => false);
        if (!supported) {
          if (!cancelled) setIsSubscribed(false);
          return;
        }

        if (!app) return;

        const swRegistration = await navigator.serviceWorker.ready;
        const messaging = getMessaging(app);

        const token = await getToken(messaging, {
          vapidKey,
          serviceWorkerRegistration: swRegistration,
        });

        if (!token) {
          if (!cancelled) setIsSubscribed(false);
          return;
        }

        if (!cancelled) {
          setCurrentToken(token);
          setIsSubscribed(true);
        }

        // Keep Firestore in sync
        await ensureTokenStored(token);
      } catch (err) {
        console.error('Error checking FCM token/subscription:', err);
        if (!cancelled) setIsSubscribed(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isSupported, user, vapidKey, isKeyLoading, ensureTokenStored]);

  const subscribe = useCallback(async () => {
    if (!isSupported || !user) {
      toast({
        title: 'Cannot Subscribe',
        description: !isSupported ? 'Push not supported.' : 'Please sign in.',
        variant: 'destructive',
      });
      return;
    }

    if (!vapidKey) {
      toast({
        title: 'Cannot Subscribe',
        description: 'VAPID key not loaded yet.',
        variant: 'destructive',
      });
      return;
    }

    if (!app) {
      toast({
        title: 'Firebase not ready',
        description: 'Firebase app not initialized.',
        variant: 'destructive',
      });
      return;
    }

    setIsSubscribing(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);

      if (perm !== 'granted') {
        toast({
          title: 'Permission denied',
          description: 'Notifications are blocked in your browser settings.',
        });
        return;
      }

      const supported = await isMessagingSupported().catch(() => false);
      if (!supported) {
        toast({
          title: 'Unsupported',
          description: 'This browser/device does not support Firebase Messaging.',
          variant: 'destructive',
        });
        return;
      }

      const swRegistration = await navigator.serviceWorker.ready;
      const messaging = getMessaging(app);

      const token = await getToken(messaging, {
        vapidKey,
        serviceWorkerRegistration: swRegistration,
      });

      if (!token) {
        throw new Error('Failed to get an FCM token.');
      }

      await ensureTokenStored(token);

      setCurrentToken(token);
      setIsSubscribed(true);

      toast({ title: 'Subscribed', description: 'Push notifications are now enabled.' });
    } catch (err: any) {
      console.error('Error subscribing to push notifications:', err);
      toast({
        title: 'Subscription Failed',
        description: err?.message || 'An unexpected error occurred.',
        variant: 'destructive',
      });
    } finally {
      setIsSubscribing(false);
    }
  }, [isSupported, toast, user, vapidKey, ensureTokenStored]);

  const unsubscribe = useCallback(async () => {
    if (!isSupported || !user) return;

    if (!app) {
      toast({
        title: 'Firebase not ready',
        description: 'Firebase app not initialized.',
        variant: 'destructive',
      });
      return;
    }

    setIsSubscribing(true);
    try {
      const supported = await isMessagingSupported().catch(() => false);
      if (!supported) {
        setIsSubscribed(false);
        return;
      }

      const swRegistration = await navigator.serviceWorker.ready;
      const messaging = getMessaging(app);

      // Ensure we have the current token (if state lost, re-fetch it)
      let token = currentToken;
      if (!token && Notification.permission === 'granted' && vapidKey) {
        token = await getToken(messaging, {
          vapidKey,
          serviceWorkerRegistration: swRegistration,
        });
      }

      // Remove token from FCM
      await deleteToken(messaging).catch(() => {});

      // Remove stored docs in Firestore
      const subsCol = collection(db, 'users', user.uid, 'pushSubscriptions');

      if (token) {
        await deleteDoc(doc(subsCol, token)).catch(() => {});
      } else {
        // fallback: delete all
        const snap = await getDocs(subsCol);
        await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
      }

      setCurrentToken(null);
      setIsSubscribed(false);

      toast({ title: 'Unsubscribed', description: 'Push notifications have been disabled.' });
    } catch (err: any) {
      console.error('Error unsubscribing from push notifications:', err);
      toast({
        title: 'Unsubscribe Failed',
        description: err?.message || 'An unexpected error occurred.',
        variant: 'destructive',
      });
    } finally {
      setIsSubscribing(false);
    }
  }, [isSupported, toast, user, vapidKey, currentToken]);

  return {
    isSupported,
    isSubscribed,
    isSubscribing,
    permission: isSupported ? permission : 'unsupported',
    isKeyLoading,
    vapidKey,
    subscribe,
    unsubscribe,
  };
}

export default usePushNotifications;
