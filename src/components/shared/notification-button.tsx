
'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { db, functions } from '@/lib/firebase';
import { collection, addDoc } from 'firebase/firestore';
import { Bell, BellRing, BellOff } from 'lucide-react';
import { Spinner } from './spinner';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { httpsCallable } from 'firebase/functions';

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
  const [isSupported, setIsSupported] = useState(false);
  const [vapidPublicKey, setVapidPublicKey] = useState<string | null>(null);
  const [keyFetchError, setKeyFetchError] = useState<string | null>(null);

  useEffect(() => {
    // 1. Check for browser support
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window) {
      setIsSupported(true);
    } else {
      setIsLoading(false);
      return;
    }

    // 2. Fetch VAPID key from the backend function
    const fetchKey = async () => {
      if (!functions) {
        setKeyFetchError('Firebase Functions client is not available.');
        setIsLoading(false);
        return;
      }
      try {
        const getVapidPublicKey = httpsCallable(functions, 'getVapidPublicKey');
        const result = await getVapidPublicKey();
        const key = (result.data as { publicKey: string }).publicKey;
        if (key) {
          setVapidPublicKey(key);
        } else {
          throw new Error("Public key was not returned from the server.");
        }
      } catch (error) {
        console.error('Could not fetch VAPID public key:', error);
        setKeyFetchError('Could not fetch configuration from the server. Ensure keys are set and functions are deployed.');
      }
    };
    
    fetchKey();
  }, []);

  useEffect(() => {
    // 3. Check for existing subscription, but only after we have a key
    if (!isSupported || !vapidPublicKey) {
      // If key fetching is done (key is null but not undefined) and it failed, stop loading.
      if (vapidPublicKey === null && keyFetchError) {
          setIsLoading(false);
      }
      return;
    }

    navigator.serviceWorker.ready.then(registration => {
      registration.pushManager.getSubscription().then(subscription => {
        setIsSubscribed(!!subscription);
        setIsLoading(false);
      });
    }).catch(() => setIsLoading(false));
  }, [isSupported, vapidPublicKey, keyFetchError]);

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

    try {
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

  const getTooltipContent = () => {
      if (!isSupported) return 'Notifications not supported by this browser.';
      if (keyFetchError) return keyFetchError;
      if (isSubscribed) return 'You are subscribed to notifications.';
      return 'Subscribe to shift notifications.';
  }
  
  constisDisabled = isLoading || !isSupported || !!keyFetchError || isSubscribed;

  return (
    <TooltipProvider>
        <Tooltip>
            <TooltipTrigger asChild>
                <Button variant="outline" size="icon" onClick={handleSubscribe} disabled={isDisabled}>
                    {isLoading ? <Spinner /> : 
                     isSubscribed ? <BellRing className="h-4 w-4" /> :
                     (!isSupported || keyFetchError) ? <BellOff className="h-4 w-4" /> :
                     <Bell className="h-4 w-4" />}
                </Button>
            </TooltipTrigger>
            <TooltipContent>
                <p>{getTooltipContent()}</p>
            </TooltipContent>
        </Tooltip>
    </TooltipProvider>
  );
}
