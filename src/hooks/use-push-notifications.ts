
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useToast } from './use-toast';
import { db, functions, httpsCallable, isFirebaseConfigured } from '@/lib/firebase';
import { useAuth } from './use-auth';
import { doc, setDoc, deleteDoc, getDoc } from 'firebase/firestore';

const urlBase64ToUint8Array = (base64String: string) => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
};

export function usePushNotifications() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && isFirebaseConfigured) {
      setIsSupported(true);
    }
  }, []);

  const getSubscription = useCallback(async () => {
      if(isSupported) {
          const registration = await navigator.serviceWorker.ready;
          const sub = await registration.pushManager.getSubscription();
          setSubscription(sub);
      }
  }, [isSupported]);

  useEffect(() => {
    const checkSubscription = async () => {
      if (isSupported && user && subscription) {
        const subDocRef = doc(db, `users/${user.uid}/pushSubscriptions/${encodeURIComponent(subscription.endpoint)}`);
        const docSnap = await getDoc(subDocRef);
        setIsSubscribed(docSnap.exists());
      } else {
        setIsSubscribed(false);
      }
    };
    checkSubscription();
  }, [isSupported, user, subscription]);

  useEffect(() => {
      getSubscription();
  }, [getSubscription]);


  const subscribe = async () => {
    if (!isSupported || !user || !functions) return;
    
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
        toast({ variant: 'destructive', title: 'Permission Denied', description: 'You must grant permission to receive notifications.' });
        return;
    }

    setIsSubscribing(true);

    try {
      const getVapidKey = httpsCallable(functions, 'getVapidPublicKey');
      const { data } = await getVapidKey() as { data: { publicKey: string } };
      
      if (!data.publicKey) {
        throw new Error('VAPID public key not found on server.');
      }
      
      const applicationServerKey = urlBase64ToUint8Array(data.publicKey);
      const registration = await navigator.serviceWorker.ready;
      const newSubscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });

      const subscriptionData = newSubscription.toJSON();
      const subDocRef = doc(db, `users/${user.uid}/pushSubscriptions/${encodeURIComponent(newSubscription.endpoint)}`);
      await setDoc(subDocRef, subscriptionData);
      
      setSubscription(newSubscription);
      setIsSubscribed(true);
      toast({ title: 'Subscribed', description: 'You will now receive notifications.' });
    } catch (error: any) {
      console.error('Failed to subscribe:', error);
      let description = 'Could not subscribe to notifications.';
      if (error.code === 'not-found') {
          description = 'Push notifications are not configured on the server yet. Please contact an administrator.';
      }
      toast({ variant: 'destructive', title: 'Subscription Failed', description });
      setIsSubscribed(false);
    } finally {
        setIsSubscribing(false);
    }
  };

  const unsubscribe = async () => {
    if (!isSupported || !user || !subscription) return;
    setIsSubscribing(true);

    try {
      await subscription.unsubscribe();
      const subDocRef = doc(db, `users/${user.uid}/pushSubscriptions/${encodeURIComponent(subscription.endpoint)}`);
      await deleteDoc(subDocRef);
      
      setSubscription(null);
      setIsSubscribed(false);
      toast({ title: 'Unsubscribed', description: 'You will no longer receive notifications.' });
    } catch (error) {
      console.error('Failed to unsubscribe:', error);
      toast({ variant: 'destructive', title: 'Unsubscribe Failed', description: 'Could not unsubscribe.' });
    } finally {
        setIsSubscribing(false);
    }
  };

  return { isSupported, isSubscribed, isSubscribing, subscribe, unsubscribe };
}
