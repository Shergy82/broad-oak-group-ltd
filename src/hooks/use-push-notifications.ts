'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { functions, httpsCallable } from '@/lib/firebase';
import type {
  PushSubscriptionPayload,
  VapidKeyResponse,
  GenericResponse,
} from '@/types';

/* =========================
   Helpers
   ========================= */

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

function endpointToId(endpoint: string) {
  let h = 0;
  for (let i = 0; i < endpoint.length; i++) {
    h = (h * 31 + endpoint.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

function fmtCallableError(err: any): string {
  return err?.message || String(err);
}

type SetNotificationStatusRequest = {
  status: 'subscribed' | 'unsubscribed';
  uid: string;
  subId: string;
  subscription?: PushSubscriptionPayload;
  endpoint?: string;
};

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

  const refreshLocalSubscriptionState = useCallback(async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setIsSubscribed(!!sub);
    } catch {
      setIsSubscribed(false);
    }
  }, []);

  useEffect(() => {
    if (!isSupported) {
      setPermission('unsupported');
      return;
    }
    setPermission(Notification.permission);
    void refreshLocalSubscriptionState();
  }, [isSupported, refreshLocalSubscriptionState]);

  useEffect(() => {
    if (!isSupported || !functions) return;

    const loadKey = async () => {
      try {
        const fn = httpsCallable<unknown, VapidKeyResponse>(
          functions,
          'getVapidPublicKey'
        );
        const res = await fn();
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
  }, [isSupported, functions, toast]);

  /* =========================
     Subscribe (FIXED)
     ========================= */

  const subscribe = useCallback(async () => {
    if (!isSupported || !user || !vapidKey || !functions) {
      toast({
        title: 'Cannot Subscribe',
        description: 'Required services are not ready.',
        variant: 'destructive',
      });
      return;
    }

    // HARD RESET (prevents permanent spinner)
    setIsSubscribing(false);
    setIsSubscribing(true);

    try {
      let perm = Notification.permission;

// iOS / PWA SAFE: only request if still default
if (perm === 'default') {
  try {
    perm = await Notification.requestPermission();
  } catch {
    perm = Notification.permission;
  }
}

setPermission(perm);

if (perm !== 'granted') {
  toast({
    title: 'Permission Required',
    description: 'Please enable notifications in browser settings.',
    variant: 'destructive',
  });
  setIsSubscribing(false);
  return;
}

const reg = await Promise.race([
  navigator.serviceWorker.ready,
  new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Service worker ready timeout')), 3000)
  ),
]);
      const existing = await reg.pushManager.getSubscription();

      const subscription =
        existing ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        }));

      const subId = `${user.uid}_${endpointToId(subscription.endpoint)}`;

      const setStatus = httpsCallable<
        SetNotificationStatusRequest,
        GenericResponse
      >(functions, 'setNotificationStatus');

      await setStatus({
        status: 'subscribed',
        uid: user.uid,
        subId,
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
  }, [isSupported, user, vapidKey, functions, toast, refreshLocalSubscriptionState]);

  /* =========================
     Unsubscribe
     ========================= */

  const unsubscribe = useCallback(async () => {
    if (!isSupported || !user || !functions) return;

    setIsSubscribing(true);

    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();

      if (!sub) {
        setIsSubscribed(false);
        return;
      }

      const endpoint = sub.endpoint;
      await sub.unsubscribe();

      const subId = `${user.uid}_${endpointToId(endpoint)}`;

      const setStatus = httpsCallable<
        SetNotificationStatusRequest,
        GenericResponse
      >(functions, 'setNotificationStatus');

      await setStatus({
        status: 'unsubscribed',
        uid: user.uid,
        subId,
        endpoint,
      });

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
  }, [isSupported, user, functions, toast, refreshLocalSubscriptionState]);

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
