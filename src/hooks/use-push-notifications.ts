'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { db, functions, httpsCallable, app } from '@/lib/firebase';
import { collection, deleteDoc, doc, getDocs, setDoc } from 'firebase/firestore';
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

  /**
   * Ensures ONLY firebase-messaging-sw.js is registered for this origin.
   * - Unregisters any other SW registrations (e.g. /service-worker.js, /sw.js)
   * - Registers /firebase-messaging-sw.js at scope "/"
   * - Waits for readiness + controller when possible
   */
  const ensureCorrectServiceWorker = useCallback(async (): Promise<ServiceWorkerRegistration> => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      throw new Error('Service workers not supported in this environment.');
    }

    // 1) Unregister any non-FCM service workers
    const regs = await navigator.serviceWorker.getRegistrations();

    // Keep track if we already have the correct one registered
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

        // Unregister anything else (this is what fixes your screenshot)
        try {
          await reg.unregister();
        } catch {
          // ignore
        }
      })
    );

    // 2) If we didn't find an existing correct registration, register it now
    if (!fcmReg) {
      fcmReg = await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
    }

    // 3) Wait until the SW is ready
    await navigator.serviceWorker.ready;

    // 4) Best-effort: ensure the page is controlled by a SW (helps iOS/Safari quirks)
    // If there is no controller yet, a reload is typically required for SW control.
    // We do NOT auto-reload here, but we can detect it and log.
    if (!navigator.serviceWorker.controller) {
      // Not controlled yet; next navigation/reload will be controlled by the SW.
      // This is normal on first install.
      // eslint-disable-next-line no-console
      console.log('[push] SW installed but page not yet controlled; reload may be required.');
    }

    return fcmReg;
  }, []);

  // Fetch VAPID key from env or callable
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

    (async () => {
      try {
        if (!functions) {
          toast({ title: 'Functions not available', variant: 'destructive' });
          return;
        }

        const getVapidPublicKey = httpsCallable<{}, { publicKey: string }>(
          functions,
          'getVapidPublicKey'
        );

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
    })();
  }, [isSupported, toast]);

  // Store token in Firestore under users/{uid}/pushSubscriptions/{token}
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

  // On load: if permission granted + vapidKey ready, get token and mark subscribed
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
      toast({
        title: 'Cannot Subscribe',
        description: 'Please sign in.',
        variant: 'destructive',
      });
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

      const setNotificationStatus = httpsCallable(functions, 'setNotificationStatus');
      const res = await setNotificationStatus({ enabled: true, token, platform: 'web' });
      console.log('[Push] Backend response:', res.data);

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

    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('Notification' in window)) {
      setIsSubscribed(false);
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
      const fcmSupported = await isMessagingSupported().catch(() => false);
      if (!fcmSupported) {
        setIsSubscribed(false);
        return;
      }

      await ensureCorrectServiceWorker();

      const messaging = getMessaging(app);

      const tokenToDelete = currentToken || null;

      await deleteToken(messaging).catch(() => {});

      const subsCol = collection(db, 'users', user.uid, 'pushSubscriptions');

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
      console.error('Error unsubscribing from push notifications:', err);
      toast({
        title: 'Unsubscribe Failed',
        description: err?.message || 'An unexpected error occurred.',
        variant: 'destructive',
      });
    } finally {
      setIsSubscribing(false);
    }
  }, [toast, user, currentToken, ensureCorrectServiceWorker]);

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
