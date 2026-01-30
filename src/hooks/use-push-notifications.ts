"use client";

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { functions, httpsCallable, firebaseConfig, isFirebaseConfigured } from "@/lib/firebase";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export function usePushNotifications() {
  const { toast } = useToast();
  const { user } = useAuth();

  const [isSupported, setIsSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isKeyLoading, setIsKeyLoading] = useState(true);
  const [vapidKey, setVapidKey] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!isFirebaseConfigured || typeof window === "undefined") {
        setIsSupported(false);
        setIsKeyLoading(false);
        return;
      }

      const supported =
        "serviceWorker" in navigator &&
        "PushManager" in window &&
        "Notification" in window;

      setIsSupported(supported);
      setPermission(Notification.permission);

      const key = firebaseConfig.vapidKey;
      setVapidKey(key || null);
      setIsKeyLoading(false);
    })();
  }, []);

  useEffect(() => {
    (async () => {
      if (!isSupported || !user) return;
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        setIsSubscribed(!!sub);
      } catch {
        setIsSubscribed(false);
      }
    })();
  }, [isSupported, user]);

  const subscribe = useCallback(async () => {
    setIsSubscribing(true);

    if (!isSupported || !user || !vapidKey) {
      toast({
        title: "Cannot Subscribe",
        description: "Push is not configured correctly.",
        variant: "destructive",
      });
      setIsSubscribing(false);
      return;
    }

    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") throw new Error("Permission denied");

      const reg = await navigator.serviceWorker.ready;

      // Create / reuse a browser PushSubscription (THIS is what iPhone needs)
      const existing = await reg.pushManager.getSubscription();
      const subscription =
        existing ||
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        }));

      const setNotificationStatus = httpsCallable(functions, "setNotificationStatus");
      await setNotificationStatus({ enabled: true, subscription: subscription.toJSON() });

      setIsSubscribed(true);

      toast({ title: "Subscribed", description: "Notifications enabled." });
    } catch (err: any) {
      toast({
        title: "Subscribe failed",
        description: err?.message || "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsSubscribing(false);
    }
  }, [isSupported, user, vapidKey, toast]);

  const unsubscribe = useCallback(async () => {
    setIsSubscribing(true);

    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();

      const setNotificationStatus = httpsCallable(functions, "setNotificationStatus");
      await setNotificationStatus({ enabled: false });

      setIsSubscribed(false);

      toast({ title: "Unsubscribed", description: "Notifications disabled." });
    } catch (err: any) {
      toast({
        title: "Unsubscribe failed",
        description: err?.message || "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsSubscribing(false);
    }
  }, [toast]);

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
