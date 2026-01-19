'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { db } from '@/lib/firebase';
import { collection, deleteDoc, doc, getDocs, setDoc } from 'firebase/firestore';

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

// ✅ Your VAPID PUBLIC key (URL-safe base64)
const VAPID_PUBLIC_KEY =
  'BLBYf-_fI0DuyhjHQhdBIBzPK8mUc7jrr5rfJYqfN_fPlx1qlSaKxEb2na8rhNIurBuZrSOV7NdK1JOaNEWpHNc';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
}

function isStandalonePWA(): boolean {
  if (typeof window === 'undefined') return false;

  // iOS Safari uses navigator.standalone
  const iOSStandalone = (window.navigator as any).standalone === true;

  // Other platforms
  const displayModeStandalone =
    window.matchMedia?.('(display-mode: standalone)')?.matches === true;

  return iOSStandalone || displayModeStandalone;
}

export function usePushNotifications(): UsePushNotificationsReturn {
  const { toast } = useToast();
  const { user } = useAuth();

  const isSupported = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }, []);

  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(
    typeof window === 'undefined' ? 'unsupported' : Notification.permission
  );

  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isSubscribing, setIsSubscribing] = useState(false);

  // No async key fetch now
  const isKeyLoading = false;
  const vapidKey = VAPID_PUBLIC_KEY;

  // Detect existing subscription (once SW is ready)
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        if (!isSupported || !user) return;
        const reg = await navigator.serviceWorker.ready;
        const existing = await reg.pushManager.getSubscription();
        if (!cancelled) setIsSubscribed(!!existing);
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isSupported, user]);

  const subscribe = useCallback(async () => {
    if (!isSupported) {
      toast({
        title: 'Push not supported',
        description: 'This browser does not support push notifications.',
        variant: 'destructive',
      });
      return;
    }

    if (!user) {
      toast({ title: 'Not signed in', description: 'Please sign in first.', variant: 'destructive' });
      return;
    }

    if (isIOS() && !isStandalonePWA()) {
      toast({
        title: 'Install required on iPhone',
        description: 'On iPhone, add this site to your Home Screen, then open it from there to enable notifications.',
        variant: 'destructive',
        duration: 10000,
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
          variant: 'destructive',
        });
        return;
      }

      const swRegistration = await navigator.serviceWorker.ready;

      const keyStr = (vapidKey ?? '').trim();
      if (!keyStr) {
        throw new Error('VAPID public key is missing.');
      }

      const appServerKey = urlBase64ToUint8Array(keyStr);

      if (appServerKey.length !== 65 || appServerKey[0] !== 0x04) {
        throw new Error(
          `applicationServerKey must contain a valid P-256 public key (decoded ${appServerKey.length} bytes).`
        );
      }

      const subscription = await swRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: appServerKey.buffer,
      });

      const subsCol = collection(db, 'users', user.uid, 'pushSubscriptions');
      const subId = btoa(subscription.endpoint).replace(/=/g, '').slice(0, 40);

      await setDoc(
        doc(subsCol, subId),
        {
          endpoint: subscription.endpoint,
          keys: subscription.toJSON().keys ?? {},
          createdAt: new Date().toISOString(),
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        },
        { merge: true }
      );

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
  }, [isSupported, toast, user, vapidKey]);

  const unsubscribe = useCallback(async () => {
    if (!isSupported || !user) return;

    setIsSubscribing(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();

      if (sub) {
        await sub.unsubscribe();

        const subsCol = collection(db, 'users', user.uid, 'pushSubscriptions');
        const snap = await getDocs(subsCol);
        await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
      }

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
  }, [isSupported, toast, user]);

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
