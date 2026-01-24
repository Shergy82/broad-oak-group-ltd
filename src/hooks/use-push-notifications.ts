'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getMessaging, getToken, isSupported as isMessagingSupported } from 'firebase/messaging';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';

type Permission = NotificationPermission | 'default';

const LS_PUSH_ENABLED_KEY = 'push_enabled'; // persists the user's bell choice

function readPushEnabled(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    const v = window.localStorage.getItem(LS_PUSH_ENABLED_KEY);
    return v === 'true';
  } catch {
    return false;
  }
}

function writePushEnabled(val: boolean) {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(LS_PUSH_ENABLED_KEY, String(val));
  } catch {
    // ignore
  }
}

export function usePushNotifications() {
  const [isSupported, setIsSupported] = useState(false);
  const [permission, setPermission] = useState<Permission>('default');
  const [isSubscribing, setIsSubscribing] = useState(false);

  // ✅ Restore the user's last choice immediately (avoids "reset" feeling)
  const [isSubscribed, setIsSubscribed] = useState<boolean>(() => readPushEnabled());

  // UI expects these
  const [isKeyLoading] = useState(false);

  // NOTE: In Next.js, this is replaced at build time.
  const vapidKey = useMemo(() => {
    return process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY || null;
  }, []);

  // 🔍 Initial capability check + permission sync
  useEffect(() => {
    (async () => {
      const supported = await isMessagingSupported();
      console.log('[Push] isSupported():', supported);
      setIsSupported(supported);

      if (typeof window !== 'undefined' && 'Notification' in window) {
        setPermission(Notification.permission);
      }

      // If user previously enabled but permission is no longer granted, reflect that in UI
      // (We do not auto-prompt here — only user action should prompt.)
      const enabled = readPushEnabled();
      if (enabled && typeof window !== 'undefined' && 'Notification' in window) {
        if (Notification.permission !== 'granted') {
          setIsSubscribed(false);
          writePushEnabled(false);
        }
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
        // User did not grant; ensure we don't "remember" enabled
        setIsSubscribed(false);
        writePushEnabled(false);
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

      // ✅ Persist the user's choice
      setIsSubscribed(true);
      writePushEnabled(true);
    } catch (err) {
      console.error('❌ PUSH SUBSCRIBE FAILED:', err);
    } finally {
      setIsSubscribing(false);
      console.log('──────── PUSH SUBSCRIBE END ────────');
    }
  }, [isSupported, vapidKey]);

  // 🔕 UNSUBSCRIBE (UI + persist choice)
  const unsubscribe = useCallback(async () => {
    console.log('[Push] Unsubscribe clicked');
    setIsSubscribed(false);
    writePushEnabled(false);

    // If/when you add backend disable, do it here (optional):
    // const setNotificationStatus = httpsCallable(functions, 'setNotificationStatus');
    // await setNotificationStatus({ enabled: false, platform: 'web' });
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
