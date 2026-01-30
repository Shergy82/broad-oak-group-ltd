'use client';

import { useCallback, useEffect, useState, useMemo } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { functions, httpsCallable } from '@/lib/firebase';
import type { PushSubscriptionPayload, VapidKeyResponse, SetStatusRequest, GenericResponse } from '@/types';

// Helper to convert VAPID key from Base64 to Uint8Array
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

  // Effect to check current subscription and permission status on load
  useEffect(() => {
    if (!isSupported) {
      setPermission('unsupported');
      return;
    }
    setPermission(Notification.permission);

    const checkSubscription = async () => {
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        setIsSubscribed(!!subscription);
      } catch (error) {
        console.error('Error checking for existing push subscription:', error);
        setIsSubscribed(false);
      }
    };
    checkSubscription();
  }, [isSupported]);

  // Effect to fetch the VAPID public key from the backend
  useEffect(() => {
    if (!isSupported) {
      setIsKeyLoading(false);
      return;
    }

    const fetchKey = async () => {
      setIsKeyLoading(true);
      try {
        const getVapidPublicKey = httpsCallable<void, VapidKeyResponse>(functions, 'getVapidPublicKey');
        const result = await getVapidPublicKey();
        const key = result.data.publicKey;
        if (!key) throw new Error('VAPID public key from server is empty.');
        setVapidKey(key);
      } catch (error) {
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
    if (!isSupported || !user || !vapidKey) {
      toast({ title: 'Cannot Subscribe', variant: 'destructive' });
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
    if (!isSupported || !user) return;
    setIsSubscribing(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        const setStatus = httpsCallable<SetStatusRequest, GenericResponse>(functions, 'setNotificationStatus');
        await setStatus({ status: 'unsubscribed', subscription: subscription.toJSON() as PushSubscriptionPayload });
        await subscription.unsubscribe();
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
