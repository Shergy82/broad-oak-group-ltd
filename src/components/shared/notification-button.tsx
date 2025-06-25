
'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { db, functions as functionsInstance } from '@/lib/firebase';
import { collection, addDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { Bell, BellRing, BellOff } from 'lucide-react';
import { Spinner } from './spinner';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

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

export function NotificationButton() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isUnsupported, setIsUnsupported] = useState(false);
  const [vapidPublicKey, setVapidPublicKey] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      setIsUnsupported(true);
      setIsLoading(false);
      return;
    }

    const fetchVapidKey = async () => {
      if (!functionsInstance) {
        toast({ variant: 'destructive', title: 'Firebase Not Initialized' });
        setIsLoading(false);
        return;
      }
      try {
        const getVapidPublicKeyCallable = httpsCallable(functionsInstance, 'getVapidPublicKey');
        const result = await getVapidPublicKeyCallable();
        const key = (result.data as { publicKey: string }).publicKey;
        if (!key) {
           throw new Error("VAPID public key was not returned from the server.");
        }
        setVapidPublicKey(key);
      } catch (error: any) {
        console.error("Failed to fetch VAPID public key:", error);
        toast({
            variant: 'destructive',
            title: 'Push Notification Setup Error',
            description: "Could not fetch configuration from the server. An admin may need to generate and set the VAPID keys.",
            duration: 10000,
        });
        setVapidPublicKey(''); // Set to empty string to signify failure
      }
    };
    
    fetchVapidKey();
  }, [toast]);
  
  useEffect(() => {
    if (vapidPublicKey === null) return; // Key is still loading
    
    if (vapidPublicKey === '') { // Key fetching failed
        setIsLoading(false);
        return;
    }

    const checkSubscription = async () => {
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        setIsSubscribed(!!subscription);
      } catch (error) {
        console.error("Error checking push subscription:", error);
      } finally {
        setIsLoading(false);
      }
    };

    checkSubscription();
  }, [vapidPublicKey]);

  const handleSubscribe = async () => {
    if (!user) {
      toast({ variant: 'destructive', title: 'You must be logged in to subscribe.' });
      return;
    }

    if (!db || !vapidPublicKey) {
      toast({ variant: 'destructive', title: 'Notifications are not configured correctly.' });
      return;
    }

    setIsLoading(true);

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      toast({
        variant: 'destructive',
        title: 'Permission Denied',
        description: 'You have blocked notifications for this site.',
      });
      setIsLoading(false);
      return;
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      const existingSubscription = await registration.pushManager.getSubscription();

      if (existingSubscription) {
          setIsSubscribed(true);
          toast({ title: 'Already Subscribed', description: 'You are already set up to receive notifications.' });
          setIsLoading(false);
          return;
      }
      
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });

      const subCollection = collection(db, 'users', user.uid, 'pushSubscriptions');
      await addDoc(subCollection, JSON.parse(JSON.stringify(subscription)));

      toast({ title: 'Subscribed!', description: 'You will now receive shift notifications.' });
      setIsSubscribed(true);
    } catch (error) {
      console.error('Failed to subscribe the user: ', error);
      toast({
        variant: 'destructive',
        title: 'Subscription Failed',
        description: 'Could not subscribe to notifications. Please try again or contact support.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (isUnsupported) {
    return null;
  }

  if (isLoading) {
    return (
      <Button variant="outline" size="icon" disabled>
        <Spinner />
      </Button>
    );
  }

  if (!vapidPublicKey) {
      return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button variant="outline" size="icon" disabled>
                        <BellOff className="h-4 w-4" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>
                    <p>Notifications are not configured on the server.</p>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
      );
  }

  if (isSubscribed) {
    return (
      <TooltipProvider>
          <Tooltip>
              <TooltipTrigger asChild>
                  <Button variant="outline" size="icon" disabled>
                      <BellRing className="h-4 w-4" />
                  </Button>
              </TooltipTrigger>
              <TooltipContent>
                  <p>You are subscribed to notifications.</p>
              </TooltipContent>
          </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
        <Tooltip>
            <TooltipTrigger asChild>
                <Button variant="outline" size="icon" onClick={handleSubscribe}>
                    <Bell className="h-4 w-4" />
                </Button>
            </TooltipTrigger>
            <TooltipContent>
                <p>Subscribe to shift notifications.</p>
            </TooltipContent>
        </Tooltip>
    </TooltipProvider>
  );
}
