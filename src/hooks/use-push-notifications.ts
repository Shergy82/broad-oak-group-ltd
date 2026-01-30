
'use client';

import { useCallback, useEffect, useState, useMemo } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import type { PushSubscriptionPayload, VapidKeyResponse, SetStatusRequest, GenericResponse } from '@/types';

const functionsBaseUrl = `https://europe-west2-${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}.cloudfunctions.net`;

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
    if (!isSupported) {
      setIsKeyLoading(false);
      return;
    }

    const fetchKey = async () => {
      setIsKeyLoading(true);
      try {
        const response = await fetch(`${functionsBaseUrl}/getVapidPublicKey`);
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to fetch VAPID key');
        }
        const data: VapidKeyResponse = await response.json();
        if (!data.publicKey) throw new Error('VAPID public key from server is empty.');
        setVapidKey(data.publicKey);
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

      const idToken = await user.getIdToken();
      const response = await fetch(`${functionsBaseUrl}/setNotificationStatus`, {
          method: 'POST',
          headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${idToken}`
          },
          body: JSON.stringify({ status: 'subscribed', subscription: subscription.toJSON() } as SetStatusRequest)
      });
      
      if (!response.ok) throw new Error('Failed to save subscription on the server.');

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
        const idToken = await user.getIdToken();
        await fetch(`${functionsBaseUrl}/setNotificationStatus`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({ status: 'unsubscribed', subscription: subscription.toJSON() } as SetStatusRequest)
        });
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

  return { isSupported, isSubscribed, isSubscribing, permission, isKeyLoading, vapidKey, subscribe, unsubscribe };
}
