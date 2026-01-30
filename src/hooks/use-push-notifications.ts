
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { functions, httpsCallable } from '@/lib/firebase';
import type { PushSubscriptionPayload, VapidKeyResponse, SetStatusRequest, GenericResponse } from '@/types';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function usePushNotifications() {
  const { toast } = useToast();
  const { user } = useAuth();

  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [isKeyLoading, setIsKeyLoading] = useState(true);
  const [vapidKey, setVapidKey] = useState<string | null>(null);

  const isSupported = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }, []);

  useEffect(() => {
    if (!isSupported) {
      setPermission('unsupported');
      return;
    }
    setPermission(Notification.permission);
    navigator.serviceWorker.ready.then(registration => {
      registration.pushManager.getSubscription().then(subscription => {
        setIsSubscribed(!!subscription);
      });
    });
  }, [isSupported]);

  useEffect(() => {
    if (!isSupported || !functions) {
      setIsKeyLoading(false);
      return;
    }
    const fetchKey = async () => {
      setIsKeyLoading(true);
      try {
        const getVapidPublicKey = httpsCallable<unknown, VapidKeyResponse>(functions, 'getVapidPublicKey');
        const result = await getVapidPublicKey();
        setVapidKey(result.data.publicKey);
      } catch (error: any) {
        console.error('Failed to fetch VAPID public key:', error);
        toast({
          variant: 'destructive',
          title: 'Notification Error',
          description: 'Could not load notification configuration from the server.',
        });
      } finally {
        setIsKeyLoading(false);
      }
    };
    fetchKey();
  }, [isSupported, toast]);
  
  const subscribe = useCallback(async () => {
    if (!isSupported || !user || !vapidKey || !functions) {
      toast({ title: 'Cannot Subscribe', description: 'Required services are not ready.', variant: 'destructive' });
      return;
    }
    setIsSubscribing(true);
    try {
      const currentPermission = await Notification.requestPermission();
      setPermission(currentPermission);
      if (currentPermission !== 'granted') {
        toast({ title: 'Permission Denied', description: 'Notifications are blocked by your browser.' });
        setIsSubscribing(false);
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const applicationServerKey = urlBase64ToUint8Array(vapidKey);
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
      const setStatus = httpsCallable<SetStatusRequest, GenericResponse>(functions, 'setNotificationStatus');
      await setStatus({ status: 'subscribed', subscription: subscription.toJSON() as PushSubscriptionPayload });
      setIsSubscribed(true);
      toast({ title: 'Subscribed!', description: 'You will now receive notifications.' });
    } catch (error: any) {
      console.error('Error subscribing to push notifications:', error);
      toast({
        title: 'Subscription Failed',
        description: error.message || 'An unexpected error occurred.',
        variant: 'destructive',
      });
    } finally {
      setIsSubscribing(false);
    }
  }, [isSupported, user, vapidKey, toast]);

  const unsubscribe = useCallback(async () => {
    if (!isSupported || !user || !functions) return;
    setIsSubscribing(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await subscription.unsubscribe();
        const setStatus = httpsCallable<SetStatusRequest, GenericResponse>(functions, 'setNotificationStatus');
        await setStatus({ status: 'unsubscribed', endpoint: subscription.endpoint });
      }
      setIsSubscribed(false);
      toast({ title: 'Unsubscribed', description: 'You will no longer receive notifications.' });
    } catch (error: any) {
      console.error('Error unsubscribing:', error);
      toast({
        title: 'Unsubscribe Failed',
        description: error.message || 'An unexpected error occurred.',
        variant: 'destructive',
      });
    } finally {
      setIsSubscribing(false);
    }
  }, [isSupported, user, toast]);

  return { isSupported, isSubscribed, isSubscribing, permission, isKeyLoading, vapidKey, subscribe, unsubscribe };
}
