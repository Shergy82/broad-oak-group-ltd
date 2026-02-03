'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { functions, httpsCallable } from '@/lib/firebase';
import type {
  PushSubscriptionPayload,
  VapidKeyResponse,
  SetStatusRequest,
  GenericResponse,
} from '@/types';

/**
 * Convert base64 (URL-safe) VAPID public key to Uint8Array for PushManager
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

// Stable-ish short id from endpoint so the same device/browser maps to the same record.
function endpointToId(endpoint: string) {
  let h = 0;
  for (let i = 0; i < endpoint.length; i++) h = (h * 31 + endpoint.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

function fmtCallableError(err: any): string {
  // Firebase callable errors usually have: code, message, details
  const code = err?.code || err?.name;
  const msg = err?.message || String(err);
  const details =
    err?.details ? (typeof err.details === 'string' ? err.details : JSON.stringify(err.details)) : '';
  return [code, msg, details].filter(Boolean).join(' | ');
}

export function usePushNotifications() {
  const { toast } = useToast();
  const { user } = useAuth();

  const [permission, setPermission] =
    useState<NotificationPermission | 'unsupported'>('default');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [isKeyLoading, setIsKeyLoading] = useState(true);
  const [vapidKey, setVapidKey] = useState<string | null>(null);

  const isSupported = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }, []);

  const refreshLocalSubscriptionState = useCallback(async () => {
    if (!isSupported) return;
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      setIsSubscribed(!!subscription);
    } catch {
      setIsSubscribed(false);
    }
  }, [isSupported]);

  useEffect(() => {
    if (!isSupported) {
      setPermission('unsupported');
      return;
    }

    setPermission(Notification.permission);
    void refreshLocalSubscriptionState();
  }, [isSupported, refreshLocalSubscriptionState]);

  useEffect(() => {
    if (!isSupported || !functions) {
      setIsKeyLoading(false);
      return;
    }

    const fetchKey = async () => {
      setIsKeyLoading(true);
      try {
        const getVapidPublicKey = httpsCallable<unknown, VapidKeyResponse>(
          functions,
          'getVapidPublicKey'
        );
        const result = await getVapidPublicKey();
        setVapidKey(result.data.publicKey);
      } catch (error: any) {
        console.error('[push] Failed to fetch VAPID public key:', error);
        toast({
          variant: 'destructive',
          title: 'Notification Error',
          description: 'Could not load notification configuration from the server.',
        });
      } finally {
        setIsKeyLoading(false);
      }
    };

    void fetchKey();
  }, [isSupported, functions, toast]);

  const subscribe = useCallback(async () => {
    if (!isSupported || !user || !vapidKey || !functions) {
      toast({
        title: 'Cannot Subscribe',
        description: 'Required services are not ready.',
        variant: 'destructive',
      });
      return;
    }

    setIsSubscribing(true);

    try {
      // Permission
      const currentPermission = await Notification.requestPermission();
      setPermission(currentPermission);

      if (currentPermission !== 'granted') {
        toast({
          title: 'Permission Denied',
          description: 'Notifications are blocked by your browser.',
        });
        return;
      }

      // SW registration + subscription
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();

      const applicationServerKey = urlBase64ToUint8Array(vapidKey);

      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        }));

      const subJson = subscription.toJSON() as PushSubscriptionPayload;

      // Callable
      type SetStatusRequestExt = SetStatusRequest & { uid: string; subId: string };

      const setStatus = httpsCallable<SetStatusRequestExt, GenericResponse>(
        functions,
        'setNotificationStatus'
      );

      const subId = `${user.uid}_${endpointToId(subscription.endpoint)}`;

      console.log('[push] calling setNotificationStatus(subscribed)', {
        uid: user.uid,
        subId,
        endpoint: subscription.endpoint,
      });

      const res = await setStatus({
        status: 'subscribed',
        uid: user.uid,
        subId,
        subscription: subJson,
      });

      console.log('[push] setNotificationStatus result:', res?.data);

      // Confirm by re-reading local subscription (browser-side)
      await refreshLocalSubscriptionState();

      toast({
        title: 'Subscribed!',
        description: 'You will now receive notifications.',
      });
    } catch (error: any) {
      console.error('[push] subscribe failed:', error);

      toast({
        title: 'Subscription Failed',
        description: fmtCallableError(error),
        variant: 'destructive',
      });

      // keep UI honest
      await refreshLocalSubscriptionState();
    } finally {
      setIsSubscribing(false);
    }
  }, [isSupported, user, vapidKey, functions, toast, refreshLocalSubscriptionState]);

  const unsubscribe = useCallback(async () => {
    if (!isSupported || !user || !functions) return;

    setIsSubscribing(true);

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (!subscription) {
        setIsSubscribed(false);
        toast({
          title: 'Unsubscribed',
          description: 'You were not subscribed on this device.',
        });
        return;
      }

      const endpoint = subscription.endpoint;
      await subscription.unsubscribe();

      type SetStatusRequestExt = SetStatusRequest & { uid: string; subId: string };
      const setStatus = httpsCallable<SetStatusRequestExt, GenericResponse>(
        functions,
        'setNotificationStatus'
      );

      const subId = `${user.uid}_${endpointToId(endpoint)}`;

      console.log('[push] calling setNotificationStatus(unsubscribed)', {
        uid: user.uid,
        subId,
        endpoint,
      });

      const res = await setStatus({
        status: 'unsubscribed',
        uid: user.uid,
        subId,
        endpoint,
      } as any);

      console.log('[push] setNotificationStatus result:', res?.data);

      await refreshLocalSubscriptionState();

      toast({
        title: 'Unsubscribed',
        description: 'You will no longer receive notifications.',
      });
    } catch (error: any) {
      console.error('[push] unsubscribe failed:', error);

      toast({
        title: 'Unsubscribe Failed',
        description: fmtCallableError(error),
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
    isKeyLoading,
    vapidKey,
    subscribe,
    unsubscribe,
  };
}
