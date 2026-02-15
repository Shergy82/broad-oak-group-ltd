'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';

import { functions } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';

/* =========================
   Helpers
========================= */

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

function fmtCallableError(err: any): string {
  return err?.message || String(err);
}

/* =========================
   Callables
========================= */

const getVapidPublicKeyFn = httpsCallable<unknown, { publicKey: string }>(
  functions,
  'getVapidPublicKey'
);

// Option B: toggle + subscription payload
const setNotificationStatusFn = httpsCallable<
  { enabled: boolean; subscription?: PushSubscriptionJSON },
  { success: boolean }
>(functions, 'setNotificationStatus');

/* =========================
   Hook
========================= */

export function usePushNotifications() {
  const { toast } = useToast();
  const { user } = useAuth();

  const [permission, setPermission] =
    useState<NotificationPermission | 'unsupported'>('default');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [vapidKey, setVapidKey] = useState<string | null>(null);

  const isSupported = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return (
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window
    );
  }, []);

  /* =========================
     Local state sync
  ========================= */

  const refreshLocalSubscriptionState = useCallback(async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setIsSubscribed(!!sub);
    } catch {
      setIsSubscribed(false);
    }
  }, []);

  /* =========================
     Permission + init
  ========================= */

  useEffect(() => {
    if (!isSupported) {
      setPermission('unsupported');
      return;
    }

    setPermission(Notification.permission);
    void refreshLocalSubscriptionState();
  }, [isSupported, refreshLocalSubscriptionState]);

  /* =========================
     Load VAPID key
  ========================= */

  useEffect(() => {
    if (!isSupported) return;

    const loadKey = async () => {
      try {
        const res = await getVapidPublicKeyFn();
        setVapidKey(res.data.publicKey);
      } catch {
        toast({
          title: 'Notification Error',
          description: 'Failed to load notification configuration.',
          variant: 'destructive',
        });
      }
    };

    void loadKey();
  }, [isSupported, toast]);

  /* =========================
     Subscribe
  ========================= */

  const subscribe = useCallback(async () => {
    if (!isSupported || !user || !vapidKey) {
      toast({
        title: 'Cannot Subscribe',
        description: 'Required services are not ready.',
        variant: 'destructive',
      });
      return;
    }

    setIsSubscribing(true);

    try {
      let perm = Notification.permission;

      if (perm === 'default') {
        perm = await Notification.requestPermission();
      }

      setPermission(perm);

      if (perm !== 'granted') {
        toast({
          title: 'Permission Required',
          description: 'Please enable notifications in browser settings.',
          variant: 'destructive',
        });
        return;
      }

      const reg = await navigator.serviceWorker.ready;

      let subscription = await reg.pushManager.getSubscription();

      if (!subscription) {
        subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        });
      }

      // ✅ Restore previous behaviour: send subscription to backend
      await setNotificationStatusFn({
        enabled: true,
        subscription: subscription.toJSON(),
      });

      await refreshLocalSubscriptionState();

      toast({
        title: 'Subscribed',
        description: 'Notifications enabled.',
      });
    } catch (err: any) {
      toast({
        title: 'Subscription Failed',
        description: fmtCallableError(err),
        variant: 'destructive',
      });
      await refreshLocalSubscriptionState();
    } finally {
      setIsSubscribing(false);
    }
  }, [
    isSupported,
    user,
    vapidKey,
    toast,
    refreshLocalSubscriptionState,
  ]);

  /* =========================
     Unsubscribe
  ========================= */

  const unsubscribe = useCallback(async () => {
    if (!isSupported || !user) return;

    setIsSubscribing(true);

    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();

      if (sub) {
        await sub.unsubscribe();
      }

      // Preference toggle only (same as before)
      await setNotificationStatusFn({ enabled: false });

      await refreshLocalSubscriptionState();

      toast({
        title: 'Unsubscribed',
        description: 'Notifications disabled.',
      });
    } catch (err: any) {
      toast({
        title: 'Unsubscribe Failed',
        description: fmtCallableError(err),
        variant: 'destructive',
      });
      await refreshLocalSubscriptionState();
    } finally {
      setIsSubscribing(false);
    }
  }, [isSupported, user, toast, refreshLocalSubscriptionState]);

  /* =========================
     Public API
  ========================= */

  return {
    isSupported,
    isSubscribed,
    isSubscribing,
    permission,
    vapidKey,
    subscribe,
    unsubscribe,
  };
}
