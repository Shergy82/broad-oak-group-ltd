
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { db, functions, httpsCallable, isFirebaseConfigured } from '@/lib/firebase';
import { getMessaging, getToken, isSupported as isFirebaseMessagingSupported } from "firebase/messaging";

type Permission = NotificationPermission | 'default';

export function usePushNotifications() {
  const { toast } = useToast();
  const { user } = useAuth();

  const [isSupported, setIsSupported] = useState(false);
  const [permission, setPermission] = useState<Permission>('default');
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isKeyLoading, setIsKeyLoading] = useState(true);
  const [vapidKey, setVapidKey] = useState<string | null>(null);

  useEffect(() => {
    async function checkSupport() {
      console.log('[Push] Checking for push notification support...');
      if (!isFirebaseConfigured || typeof window === 'undefined') {
        console.log('[Push] Firebase not configured or not in a browser env.');
        setIsSupported(false);
        setIsKeyLoading(false);
        return;
      }
      
      const supported = await isFirebaseMessagingSupported();
      setIsSupported(supported);
      console.log('[Push] Browser support:', supported);

      if (supported && 'Notification' in window) {
        setPermission(Notification.permission);
        console.log('[Push] Initial notification permission state:', Notification.permission);
      }
    }
    checkSupport();
  }, []);

  useEffect(() => {
    async function fetchVapidKey() {
      if (!isSupported) {
        setIsKeyLoading(false);
        return;
      }
      console.log('[Push] Fetching VAPID key...');
      setIsKeyLoading(true);
      if (!functions) {
          console.error('[Push] Firebase Functions is not available.');
          setIsKeyLoading(false);
          return;
      }
      try {
        const getVapidPublicKey = httpsCallable<{ }, { publicKey: string }>(functions, 'getVapidPublicKey');
        const result = await getVapidPublicKey();
        const key = result.data.publicKey;
        if (key) {
          setVapidKey(key);
          console.log('[Push] VAPID key loaded successfully.');
        } else {
          console.error('[Push] VAPID public key is missing from server response.');
        }
      } catch (error) {
        console.error('[Push] Failed to fetch VAPID public key:', error);
      } finally {
        setIsKeyLoading(false);
      }
    }
    fetchVapidKey();
  }, [isSupported]);
  
  const subscribe = useCallback(async () => {
    console.log('[Push] Subscribe process started...');
    setIsSubscribing(true);

    if (!isSupported || !user || !vapidKey) {
      const reason = !isSupported ? 'Push not supported' : !user ? 'User not logged in' : 'VAPID key not loaded';
      console.error('[Push] Pre-condition for subscribe failed:', reason);
      toast({ title: 'Cannot Subscribe', description: reason, variant: 'destructive' });
      setIsSubscribing(false);
      return;
    }

    try {
      const perm = await Notification.requestPermission();
      console.log('[Push] Notification permission request result:', perm);
      setPermission(perm);
      if (perm !== 'granted') {
        throw new Error('Notification permission was not granted.');
      }
      
      const messaging = getMessaging();
      console.log('[Push] Firebase Messaging instance obtained.');

      console.log('[Push] Requesting FCM token with VAPID key...');
      const fcmToken = await getToken(messaging, { vapidKey });

      if (!fcmToken) {
        throw new Error('Failed to retrieve FCM token from Firebase.');
      }
      console.log('[Push] FCM Token received:', fcmToken);

      console.log('[Push] Calling backend function "setNotificationStatus"...');
      const setNotificationStatus = httpsCallable(functions, 'setNotificationStatus');
      await setNotificationStatus({ enabled: true, token: fcmToken });
      
      console.log('[Push] Backend call successful. Updating state to subscribed.');
      setIsSubscribed(true);
      toast({ title: 'Subscribed!', description: 'You will now receive notifications.' });
    } catch (err: any) {
      console.error('[Push] Subscribe failed:', err);
      toast({
        title: 'Subscription Failed',
        description: err.message || 'An unexpected error occurred.',
        variant: 'destructive',
      });
    } finally {
      setIsSubscribing(false);
      console.log('[Push] Subscribe process finished.');
    }
  }, [isSupported, user, vapidKey, toast]);

  const unsubscribe = useCallback(async () => {
    console.log('[Push] Unsubscribe process started...');
    setIsSubscribing(true);
    if (!user || !functions) {
      setIsSubscribing(false);
      return;
    }

    try {
      const setNotificationStatus = httpsCallable(functions, 'setNotificationStatus');
      console.log('[Push] Calling backend to unsubscribe all tokens...');
      await setNotificationStatus({ enabled: false });

      console.log('[Push] Backend call successful. Updating state to unsubscribed.');
      setIsSubscribed(false);
      toast({ title: 'Unsubscribed', description: 'You will no longer receive notifications.' });
    } catch (err: any) {
      console.error('[Push] Unsubscribe failed:', err);
       toast({
        title: 'Unsubscribe Failed',
        description: err.message || 'An unexpected error occurred.',
        variant: 'destructive',
      });
    } finally {
      setIsSubscribing(false);
      console.log('[Push] Unsubscribe process finished.');
    }
  }, [user, toast]);

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
