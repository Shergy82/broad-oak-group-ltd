
'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { db } from '@/lib/firebase';
import { collection, addDoc } from 'firebase/firestore';
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
  const [isSupported, setIsSupported] = useState(false);
  
  // The VAPID key is now read directly from the environment variables.
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window) {
      setIsSupported(true);
      navigator.serviceWorker.ready.then(registration => {
        registration.pushManager.getSubscription().then(subscription => {
          setIsSubscribed(!!subscription);
          setIsLoading(false);
        });
      });
    } else {
      setIsLoading(false);
    }
  }, []);

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
  
  if (!isSupported) {
      return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button variant="outline" size="icon" disabled>
                        <BellOff className="h-4 w-4" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>
                    <p>Notifications not supported by this browser.</p>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
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
                    <p>Notifications not configured. Please set the VAPID key in the Admin panel and restart the server.</p>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
      );
  }

  if (isLoading) {
    return (
      <Button variant="outline" size="icon" disabled>
        <Spinner />
      </Button>
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
