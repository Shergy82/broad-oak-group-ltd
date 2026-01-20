'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { db, functions, httpsCallable } from '@/lib/firebase';
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
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
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

  useEffect(() => {
    if (!isSupported) {
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
        setIsKeyLoading(true);
        const getVapidPublicKey = httpsCallable<{ }, { publicKey: string }>(functions, 'getVapidPublicKey');
        const result = await getVapidPublicKey();
        const key = result.data.publicKey;
        if (key) {
          setVapidKey(key);
        } else {
          throw new Error('VAPID public key is missing from server response.');
        }
      } catch (error: any) {
        console.error('Failed to fetch VAPID public key:', error);
      } finally {
        setIsKeyLoading(false);
      }
    }

    fetchVapidKey();
  }, [isSupported, toast]);

  useEffect(() => {
    if (!isSupported || !user) return;
    
    let cancelled = false;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const existing = await reg.pushManager.getSubscription();
        if (!cancelled) {
          setIsSubscribed(!!existing);
        }
      } catch (err){
        console.error("Error checking push subscription status:", err);
      }
    })();

    return () => { cancelled = true; };
  }, [isSupported, user]);

  const saveSubscription = useCallback(async (subscription: PushSubscription) => {
    if (!db || !user) return;
    
    // Create a stable, URL-safe ID from the endpoint
    const subId = btoa(subscription.endpoint).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const subsCol = collection(db, 'users', user.uid, 'pushSubscriptions');
    const subDoc = doc(subsCol, subId);

    await setDoc(subDoc, {
        endpoint: subscription.endpoint,
        keys: subscription.toJSON().keys ?? {},
        createdAt: new Date().toISOString(),
        userAgent: navigator.userAgent,
    }, { merge: true });
  }, [user]);

  const subscribe = useCallback(async () => {
    if (!isSupported || !user || !vapidKey) {
        toast({ 
            title: 'Cannot Subscribe', 
            description: !isSupported ? 'Push not supported.' : !user ? 'Please sign in.' : 'VAPID key not loaded.',
            variant: 'destructive'
        });
      return;
    }

    setIsSubscribing(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      let subscription = await reg.pushManager.getSubscription();

      if (subscription) {
        // Already subscribed, just ensure it's on our server
        await saveSubscription(subscription);
      } else {
        const perm = await Notification.requestPermission();
        setPermission(perm);

        if (perm !== 'granted') {
          throw new Error('Notifications permission was not granted.');
        }
        
        const applicationServerKey = urlBase64ToUint8Array(vapidKey);
        subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        });

        await saveSubscription(subscription);
      }

      setIsSubscribed(true);
      toast({ title: 'Subscribed!', description: 'Push notifications are now enabled.' });
    } catch (err: any) {
      console.error('Error subscribing to push notifications:', err);
      toast({
        title: 'Subscription Failed',
        description: err?.message || 'An unexpected error occurred.',
        variant: 'destructive',
      });
      setIsSubscribed(false); // Ensure state is correct on failure
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

      if (sub) {
        await sub.unsubscribe();
      }

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
      // A small delay to ensure the system processes the unsubscription before re-subscribing
      await new Promise(resolve => setTimeout(resolve, 500));
      await subscribe();
    } catch (error) {
      console.error("Error during notification reset:", error);
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
    reset
  };
}
