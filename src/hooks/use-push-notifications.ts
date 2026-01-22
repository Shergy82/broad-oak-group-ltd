'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { db, app } from '@/lib/firebase';
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
  reset: () => Promise<void>;
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
        } catch {}
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

  // Load VAPID public key (ENV only)
  useEffect(() => {
    if (!isSupported) {
      setIsKeyLoading(false);
      return;
    }

    const envKey = (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '').trim();
    if (!envKey) {
      console.error('NEXT_PUBLIC_VAPID_PUBLIC_KEY is missing.');
      setVapidKey(null);
      setIsKeyLoading(false);
      return;
    }

    setVapidKey(envKey);
    setIsKeyLoading(false);
  }, [isSupported]);

  // store token
  const ensureTokenStored = useCallback(
    async (token: string) => {
      if (!user) return;
      const subsCol = collection(db, 'users', user.uid, 'pushTokens');
      const tokenDoc = doc(subsCol, token);

      await setDoc(
        tokenDoc,
        {
          token,
          updatedAt: new Date().toISOString(),
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        },
        { merge: true }
      );
    },
    [user]
  );

  // On load: if granted, get token and mark subscribed
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        if (!isSupported || !user) return;
        if (isKeyLoading || !vapidKey?.trim()) return;

        if (Notification.permission !== 'granted') {
          if (!cancelled) setIsSubscribed(false);
          return;
        }

        const fcmSupported = await isMessagingSupported().catch(() => false);
        if (!fcmSupported) {
          if (!cancelled) setIsSubscribed(false);
          return;
        }

        if (!app) return;

        const reg = await ensureCorrectServiceWorker();
        const messaging = getMessaging(app);

        const token = await getToken(messaging, {
          vapidKey: vapidKey.trim(),
          serviceWorkerRegistration: reg,
        });

        if (!token) {
          if (!cancelled) setIsSubscribed(false);
          return;
        }

        await ensureTokenStored(token);

        if (!cancelled) {
          setCurrentToken(token);
          setIsSubscribed(true);
        }
      } catch (err) {
        console.error('Error checking FCM token/subscription:', err);
        if (!cancelled) setIsSubscribed(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isSupported, user, vapidKey, isKeyLoading, ensureTokenStored, ensureCorrectServiceWorker]);

  const subscribe = useCallback(async () => {
    if (!user) {
      toast({ title: 'Cannot Subscribe', description: 'Please sign in.', variant: 'destructive' });
      return;
    }

    if (typeof window === 'undefined' || !('Notification' in window) || !('serviceWorker' in navigator)) {
      toast({
        title: 'Cannot Subscribe',
        description: 'Notifications are not supported on this device/browser.',
        variant: 'destructive',
      });
      return;
    }

    if (!vapidKey?.trim()) {
      toast({ title: 'Cannot Subscribe', description: 'VAPID key not loaded yet.', variant: 'destructive' });
      return;
    }

    if (!app) {
      toast({ title: 'Firebase not ready', description: 'Firebase app not initialized.', variant: 'destructive' });
      return;
    }

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
        toast({
          title: 'Unsupported',
          description: 'This browser/device does not support Firebase Messaging.',
          variant: 'destructive',
        });
        return;
      }

      const reg = await ensureCorrectServiceWorker();
      const messaging = getMessaging(app);

      const token = await getToken(messaging, {
        vapidKey: vapidKey.trim(),
        serviceWorkerRegistration: reg,
      });

      if (!token) throw new Error('Failed to get an FCM token.');

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
  }, [toast, user, vapidKey, ensureTokenStored, ensureCorrectServiceWorker]);

  const unsubscribe = useCallback(async () => {
    if (!user) return;

    setIsSubscribing(true);
    try {
      const fcmSupported = await isMessagingSupported().catch(() => false);
      if (!fcmSupported) {
        setIsSubscribed(false);
        return;
      }

      if (!app) return;

      await ensureCorrectServiceWorker();
      const messaging = getMessaging(app);

      const tokenToDelete = currentToken || null;

      await deleteToken(messaging).catch(() => {});

      const subsCol = collection(db, 'users', user.uid, 'pushTokens');

      if (tokenToDelete) {
        await deleteDoc(doc(subsCol, tokenToDelete)).catch(() => {});
      } else {
        const snap = await getDocs(subsCol);
        await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
      }

      setCurrentToken(null);
      setIsSubscribed(false);

      toast({ title: 'Unsubscribed', description: 'Push notifications have been disabled.' });
    } catch (err: any) {
      console.error('Error unsubscribing:', err);
      toast({
        title: 'Unsubscribe Failed',
        description: err?.message || 'An unexpected error occurred.',
        variant: 'destructive',
      });
    } finally {
      setIsSubscribing(false);
    }
  }, [toast, user, currentToken, ensureCorrectServiceWorker]);

  // Reset: remove SW + clear tokens locally + clear Firestore tokens
  const reset = useCallback(async () => {
    try {
      if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

      // unregister everything
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister().catch(() => {})));

      // clear Firestore tokens for this user
      if (user) {
        const subsCol = collection(db, 'users', user.uid, 'pushTokens');
        const snap = await getDocs(subsCol);
        await Promise.all(snap.docs.map((d) => deleteDoc(d.ref).catch(() => {})));
      }

      setCurrentToken(null);
      setIsSubscribed(false);

      toast({ title: 'Reset done', description: 'Now refresh and subscribe again.' });
    } catch (e: any) {
      console.error('Reset failed', e);
      toast({ title: 'Reset failed', description: e?.message || 'Unknown error', variant: 'destructive' });
    }
  }, [toast, user]);

  return {
    isSupported,
    isSubscribed,
    isSubscribing,
    permission: isSupported ? permission : 'unsupported',
    isKeyLoading,
    vapidKey,
    subscribe,
    unsubscribe,
    reset,
  };
}

export default usePushNotifications;
