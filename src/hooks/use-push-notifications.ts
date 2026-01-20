'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { db } from '@/lib/firebase';
import { collection, deleteDoc, doc, getDocs, setDoc, query } from 'firebase/firestore';

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

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const s = (base64String || "").trim();

  // Must be URL-safe base64 chars only (no spaces/newlines/quotes)
  if (!/^[A-Za-z0-9\-_]+$/.test(s)) {
    throw new Error("VAPID key contains invalid characters (spaces/newlines/wrong key).");
  }

  const padding = "=".repeat((4 - (s.length % 4)) % 4);
  const base64 = (s + padding).replace(/-/g, "+").replace(/_/g, "/");

  let rawData = "";
  try {
    rawData = window.atob(base64);
  } catch {
    throw new Error("VAPID key is not valid base64url (atob failed).");
  }

  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);

  console.log("Converted Uint8Array length:", outputArray.length);
  return outputArray;
}

export function usePushNotifications(): UsePushNotificationsReturn {
  const { toast } = useToast();
  const { user } = useAuth();

  const isSupported = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }, []);

  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(
    typeof window !== 'undefined' ? Notification.permission : 'unsupported'
  );
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [isKeyLoading, setIsKeyLoading] = useState(true);
  const [vapidKey, setVapidKey] = useState<string | null>(null);

  // ✅ Load VAPID key from env (no callable)
  useEffect(() => {
    if (!isSupported) {
      setIsKeyLoading(false);
      return;
    }

    const key = (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '').trim();

    if (!key) {
      console.error('NEXT_PUBLIC_VAPID_PUBLIC_KEY is missing in .env.local');
      setVapidKey(null);
      setIsKeyLoading(false);
      return;
    }

    setVapidKey(key);
    setIsKeyLoading(false);

    // optional sanity logs (remove later)
    console.log('VAPID key starts:', key.slice(0, 10));
    console.log('VAPID key length:', key.length);
  }, [isSupported]);

  // ✅ Check existing subscription
  useEffect(() => {
    if (!isSupported || !user) return;

    let cancelled = false;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const existing = await reg.pushManager.getSubscription();
        if (!cancelled) setIsSubscribed(!!existing);
      } catch (err) {
        console.error('Error checking push subscription status:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isSupported, user]);

  const saveSubscription = useCallback(
    async (subscription: PushSubscription) => {
      if (!db || !user) return;

      const subId = btoa(subscription.endpoint)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      const subsCol = collection(db, 'users', user.uid, 'pushSubscriptions');
      const subDoc = doc(subsCol, subId);

      await setDoc(
        subDoc,
        {
          endpoint: subscription.endpoint,
          keys: subscription.toJSON().keys ?? {},
          createdAt: new Date().toISOString(),
          userAgent: navigator.userAgent,
        },
        { merge: true }
      );
    },
    [user]
  );

  const subscribe = useCallback(async () => {
    if (!isSupported || !user || !vapidKey) {
      toast({
        title: 'Cannot Subscribe',
        description: !isSupported ? 'Push not supported.' : !user ? 'Please sign in.' : 'VAPID key not loaded.',
        variant: 'destructive',
      });
      return;
    }

    setIsSubscribing(true);

    try {
      const reg = await navigator.serviceWorker.ready;

      // If already subscribed, just ensure it's saved
      let subscription = await reg.pushManager.getSubscription();
      if (subscription) {
        await saveSubscription(subscription);
        setIsSubscribed(true);
        toast({ title: 'Subscribed!', description: 'Push notifications are already enabled.' });
        return;
      }

      const perm = await Notification.requestPermission();
      setPermission(perm);

      if (perm !== 'granted') {
        throw new Error('Notifications permission was not granted.');
      }

      // ✅ MUST be Uint8Array
      const applicationServerKey = urlBase64ToUint8Array(vapidKey);

      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });

      await saveSubscription(subscription);

      setIsSubscribed(true);
      toast({ title: 'Subscribed!', description: 'Push notifications are now enabled.' });
    } catch (err: any) {
      console.error('Error subscribing to push notifications:', err);
      toast({
        title: 'Subscription Failed',
        description: err?.message || 'An unexpected error occurred.',
        variant: 'destructive',
      });
      setIsSubscribed(false);
    } finally {
      setIsSubscribing(false);
    }
  }, [isSupported, toast, user, vapidKey, saveSubscription]);

  const unsubscribe = useCallback(async () => {
    if (!isSupported || !user) return;

    setIsSubscribing(true);

    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();

      if (sub) await sub.unsubscribe();

      if (db) {
        const subsQuery = query(collection(db, 'users', user.uid, 'pushSubscriptions'));
        const snap = await getDocs(subsQuery);
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

  const reset = useCallback(async () => {
    setIsSubscribing(true);
    try {
      await unsubscribe();
      await new Promise((resolve) => setTimeout(resolve, 500));
      await subscribe();
    } catch (error) {
      console.error('Error during notification reset:', error);
    } finally {
      setIsSubscribing(false);
    }
  }, [unsubscribe, subscribe]);

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