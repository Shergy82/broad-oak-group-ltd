
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { db, functions, httpsCallable, isFirebaseConfigured } from '@/lib/firebase';
import {
  collection,
  addDoc,
  query,
  where,
  getDocs,
  deleteDoc,
  doc,
} from 'firebase/firestore';

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function usePushNotifications() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [isSupported, setIsSupported] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window) {
      setIsSupported(true);
    }
  }, []);

  const getSubscription = useCallback(async () => {
    if (!isSupported) return null;
    const registration = await navigator.serviceWorker.ready;
    return registration.pushManager.getSubscription();
  }, [isSupported]);

  useEffect(() => {
    const checkSubscription = async () => {
      const subscription = await getSubscription();
      setIsSubscribed(!!subscription);
    };
    if (isSupported && user) {
      checkSubscription();
    }
  }, [isSupported, user, getSubscription]);

  const subscribe = async () => {
    if (!isSupported || !user || !isFirebaseConfigured || !functions || !db) {
      toast({ variant: 'destructive', title: 'Error', description: 'Push notifications are not fully configured.' });
      return;
    }

    const registration = await navigator.serviceWorker.ready;
    if (await registration.pushManager.getSubscription()) {
      toast({ title: 'Already Subscribed', description: 'You are already subscribed to notifications.' });
      setIsSubscribed(true);
      return;
    }

    setIsSubscribing(true);
    try {
      const getVapidKey = httpsCallable(functions, 'getVapidPublicKey');
      const result = await getVapidKey() as { data: { publicKey: string } };
      const publicKey = result.data.publicKey;

      if (!publicKey) {
        throw new Error('VAPID public key not found on server.');
      }
      
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      
      const subscriptionsRef = collection(db, 'users', user.uid, 'pushSubscriptions');
      await addDoc(subscriptionsRef, JSON.parse(JSON.stringify(subscription)));

      setIsSubscribed(true);
      toast({ title: 'Subscribed!', description: "You'll now receive shift notifications." });
    } catch (error: any) {
      console.error('Error subscribing to push notifications', error);
      let description = 'Could not subscribe to notifications. Please try again.';
      if (error.code === 'permission-denied' || error.name === 'NotAllowedError') {
        description = 'Notification permission was denied. Please enable it in your browser settings.';
      } else if (error.message?.includes('VAPID')) {
        description = 'The server is not configured for push notifications. Contact an administrator.';
      }
      toast({ variant: 'destructive', title: 'Subscription Failed', description });
      setIsSubscribed(false);
    } finally {
      setIsSubscribing(false);
    }
  };

  const unsubscribe = async () => {
    if (!isSupported || !user || !db) return;

    setIsSubscribing(true);
    try {
      const subscription = await getSubscription();
      if (!subscription) {
          setIsSubscribed(false);
          return;
      }
      
      const subscriptionsRef = collection(db, 'users', user.uid, 'pushSubscriptions');
      const q = query(subscriptionsRef, where('endpoint', '==', subscription.endpoint));
      const querySnapshot = await getDocs(q);

      const deletePromises: Promise<void>[] = [];
      querySnapshot.forEach((subscriptionDoc) => {
        deletePromises.push(deleteDoc(doc(db, 'users', user.uid, 'pushSubscriptions', subscriptionDoc.id)));
      });

      await Promise.all(deletePromises);
      await subscription.unsubscribe();
      
      setIsSubscribed(false);
      toast({ title: 'Unsubscribed', description: 'You will no longer receive notifications.' });
    } catch (error) {
      console.error('Error unsubscribing', error);
      toast({ variant: 'destructive', title: 'Unsubscription Failed', description: 'Could not unsubscribe. Please try again.' });
    } finally {
      setIsSubscribing(false);
    }
  };

  return { isSupported, isSubscribed, isSubscribing, subscribe, unsubscribe };
}
