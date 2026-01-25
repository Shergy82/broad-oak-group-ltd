'use client';

import { useCallback, useEffect, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { functions, httpsCallable, app } from '@/lib/firebase';
import { getMessaging, getToken, deleteToken } from 'firebase/messaging';

interface UsePushNotificationsReturn {
  isSupported: boolean;
  isSubscribed: boolean;
  isSubscribing: boolean;
  permission: NotificationPermission;
  subscribe: () => Promise<void>;
  unsubscribe: () => Promise<void>;
}

export function usePushNotifications(): UsePushNotificationsReturn {
  const { toast } = useToast();
  const { user } = useAuth();
  
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isSubscribing, setIsSubscribing] = useState(false);

  const isSupported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;
  const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY?.trim() || '';

  const getSubscriptionStatus = useCallback(async () => {
    if (!isSupported) return;
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      setIsSubscribed(!!subscription);
    } catch (e) {
        console.error("Could not get subscription status", e);
        setIsSubscribed(false);
    }
  }, [isSupported]);

  useEffect(() => {
    if (isSupported) {
      setPermission(Notification.permission);
      getSubscriptionStatus();
    }
  }, [isSupported, getSubscriptionStatus]);

  const subscribe = useCallback(async () => {
    if (!isSupported || !user || !vapidKey || !app || !functions) {
      toast({ title: "Cannot Subscribe", description: "Required services are not ready.", variant: "destructive" });
      return;
    }
    
    setIsSubscribing(true);
    try {
      const currentPermission = await Notification.requestPermission();
      setPermission(currentPermission);
      if (currentPermission !== 'granted') {
        toast({ title: 'Permission Denied', description: 'Notifications are blocked in browser settings.', variant: 'destructive' });
        setIsSubscribing(false);
        return;
      }
      
      const messaging = getMessaging(app);
      const token = await getToken(messaging, { vapidKey });

      if (token) {
        const setStatus = httpsCallable(functions, 'setNotificationStatus');
        await setStatus({ enabled: true, token });
        setIsSubscribed(true);
        toast({ title: 'Subscribed!', description: 'You will now receive notifications.' });
      } else {
        throw new Error('Failed to acquire a push token.');
      }
    } catch (error: any) {
      console.error('Error subscribing:', error);
      toast({ title: 'Subscription Failed', description: error.message || 'An unknown error occurred.', variant: 'destructive' });
      setIsSubscribed(false);
    } finally {
      setIsSubscribing(false);
    }
  }, [isSupported, user, vapidKey, app, functions, toast]);

  const unsubscribe = useCallback(async () => {
    if (!isSupported || !user || !app || !functions) return;

    setIsSubscribing(true);
    try {
      const messaging = getMessaging(app);
      const token = await getToken(messaging, { vapidKey }).catch(() => null);

      await deleteToken(messaging);

      const setStatus = httpsCallable(functions, 'setNotificationStatus');
      await setStatus({ enabled: false, token: token });

      setIsSubscribed(false);
      toast({ title: 'Unsubscribed', description: 'You will no longer receive push notifications.' });
    } catch (error: any) {
      console.error('Error unsubscribing:', error);
      toast({ title: 'Unsubscribe Failed', description: error.message || 'An unknown error occurred.', variant: 'destructive' });
      getSubscriptionStatus();
    } finally {
      setIsSubscribing(false);
    }
  }, [isSupported, user, app, functions, toast, getSubscriptionStatus, vapidKey]);

  return {
    isSupported,
    isSubscribed,
    isSubscribing,
    permission,
    subscribe,
    unsubscribe,
  };
}
