
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './use-auth';
import { db, isFirebaseConfigured } from '@/lib/firebase';
import { collection, addDoc, getDocs, query, where, deleteDoc } from 'firebase/firestore';
import { useToast } from './use-toast';

// This is a URL-safe base64 encoder
function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function usePushNotifications() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [permissionStatus, setPermissionStatus] = useState<NotificationPermission>('default');

  const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  // Check current subscription status on component mount
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window) {
      setPermissionStatus(Notification.permission);
      navigator.serviceWorker.ready.then((registration) => {
        registration.pushManager.getSubscription().then((sub) => {
          if (sub) {
            setSubscription(sub);
            setIsSubscribed(true);
          }
          setIsLoading(false);
        });
      });
    } else {
        setIsLoading(false);
    }
  }, []);

  const subscribe = useCallback(async () => {
    if (!isFirebaseConfigured || !db || !user) {
      toast({ variant: 'destructive', title: 'Error', description: 'User or Firebase is not available.' });
      return;
    }
    if (!VAPID_PUBLIC_KEY) {
      toast({ variant: 'destructive', title: 'Configuration Error', description: 'VAPID public key is not set. Please add it to your .env.local file.' });
      console.error('VAPID public key not found in environment variables.');
      return;
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });

      // Save subscription to Firestore
      const subscriptionsRef = collection(db, `users/${user.uid}/pushSubscriptions`);
      await addDoc(subscriptionsRef, sub.toJSON());

      setSubscription(sub);
      setIsSubscribed(true);
      setPermissionStatus('granted');
      toast({ title: 'Subscribed!', description: 'You will now receive notifications for new shifts.' });
    } catch (error) {
      console.error('Failed to subscribe the user: ', error);
       if (Notification.permission === 'denied') {
        toast({ variant: 'destructive', title: 'Permission Denied', description: 'Please enable notifications in your browser settings.' });
       } else {
        toast({ variant: 'destructive', title: 'Subscription Failed', description: 'Could not subscribe to notifications.' });
       }
       setPermissionStatus(Notification.permission);
    }
  }, [user, toast, VAPID_PUBLIC_KEY]);

  const unsubscribe = useCallback(async () => {
    if (!subscription || !db || !user) return;

    try {
      // Find the subscription in Firestore to delete it
      const subscriptionsRef = collection(db, `users/${user.uid}/pushSubscriptions`);
      const q = query(subscriptionsRef, where('endpoint', '==', subscription.endpoint));
      const querySnapshot = await getDocs(q);
      
      const deletePromises: Promise<void>[] = [];
      querySnapshot.forEach((doc) => {
          deletePromises.push(deleteDoc(doc.ref));
      });
      await Promise.all(deletePromises);
      
      // Unsubscribe from the browser's push service
      await subscription.unsubscribe();

      setSubscription(null);
      setIsSubscribed(false);
      toast({ title: 'Unsubscribed', description: 'You will no longer receive notifications.' });
    } catch (error) {
      console.error('Failed to unsubscribe the user: ', error);
      toast({ variant: 'destructive', title: 'Unsubscribe Failed', description: 'Could not unsubscribe.' });
    }
  }, [subscription, user, toast]);

  return { isSubscribed, subscribe, unsubscribe, isLoading, permissionStatus };
}
