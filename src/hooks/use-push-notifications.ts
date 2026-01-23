'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getMessaging, getToken, isSupported as isMessagingSupported } from 'firebase/messaging';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';

type Permission = NotificationPermission | 'default';

export function usePushNotifications() {
  const [isSupported, setIsSupported] = useState(false);
  const [permission, setPermission] = useState<Permission>('default');
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);

  // UI expects these
  const [isKeyLoading] = useState(false);

  // NOTE: In Next.js, this is replaced at build time.
  const vapidKey = useMemo(() => {
    return process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY || null;
  }, []);

  // 🔍 Initial capability check
  useEffect(() => {
    (async () => {
      const supported = await isMessagingSupported();
      console.log('[Push] isSupported():', supported);
      setIsSupported(supported);

      if (typeof window !== 'undefined' && 'Notification' in window) {
        setPermission(Notification.permission);
      }
    })();
  }, []);

  // 🔔 SUBSCRIBE
  const subscribe = useCallback(async () => {
    console.log('──────── PUSH SUBSCRIBE START ────────');
    setIsSubscribing(true);

    try {
      if (!isSupported) {
        throw new Error('Push not supported in this browser');
      }

      if (typeof window === 'undefined') {
        throw new Error('No window (client-only)');
      }

      if (!('serviceWorker' in navigator)) {
        throw new Error('Service workers not supported');
      }

      // Permission
      const perm = await Notification.requestPermission();
      console.log('[Push] Notification permission:', perm);
      setPermission(perm);

      if (perm !== 'granted') {
        throw new Error('Notification permission not granted');
      }

      // Ensure SW is controlling the page
      const registration = await navigator.serviceWorker.ready;
      console.log('[Push] Service worker ready:', registration);

      // VAPID check (definitive)
      console.log('[Push] VAPID key present:', !!vapidKey, vapidKey ? vapidKey.slice(0, 10) : null);

      if (!vapidKey) {
        throw new Error('Missing NEXT_PUBLIC_FIREBASE_VAPID_KEY');
      }

      const messaging = getMessaging();
      console.log('[Push] Messaging instance created');

      console.log('[Push] Requesting FCM token…');

      // IMPORTANT: Do NOT pass serviceWorkerRegistration here.
      const token = await getToken(messaging, { vapidKey });

      console.log('[Push] getToken() result:', token);

      if (!token) {
        console.error('🔥🔥🔥 NO TOKEN RETURNED 🔥🔥🔥');
        throw new Error('FCM token is null or empty');
      }

      console.log('✅ TOKEN CONFIRMED:', token);

      // Send token to backend
      const setNotificationStatus = httpsCallable(functions, 'setNotificationStatus');
      console.log('[Push] Sending token to backend…');

      await setNotificationStatus({
        enabled: true,
        token,
        platform: 'web',
      });

      console.log('✅ Token sent to backend');
      setIsSubscribed(true);
    } catch (err) {
      console.error('❌ PUSH SUBSCRIBE FAILED:', err);
    } finally {
      setIsSubscribing(false);
      console.log('──────── PUSH SUBSCRIBE END ────────');
    }
  }, [isSupported, vapidKey]);

  // 🔕 UNSUBSCRIBE (UI-only for now)
  const unsubscribe = useCallback(async () => {
    console.log('[Push] Unsubscribe clicked');
    setIsSubscribed(false);
  }, []);

  return {
    isSupported,
    isSubscribed,
    isSubscribing,
    isKeyLoading,
    vapidKey,
    permission,
    subscribe,
    unsubscribe,
  };
}
