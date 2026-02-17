'use client';

import { Bell, BellOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { usePushNotifications } from '@/hooks/use-push-notifications';

export default function PushToggleButton() {
  const { toast } = useToast();
  const { isSupported, isSubscribed, subscribe, unsubscribe } =
    usePushNotifications();

  if (!isSupported) {
    return (
      <Button variant="ghost" size="icon" disabled>
        <BellOff className="h-5 w-5 opacity-50" />
      </Button>
    );
  }

  const handleClick = () => {
    try {
      if (isSubscribed) {
        unsubscribe();
        toast({ title: 'Notifications disabled' });
      } else {
        subscribe();
        toast({ title: 'Notifications enabled' });
      }
    } catch (err: any) {
      toast({
        title: 'Notification error',
        description: err?.message || 'Something went wrong',
        variant: 'destructive',
      });
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={handleClick}
      aria-label="Toggle notifications"
    >
      {isSubscribed ? (
        <Bell className="h-5 w-5" />
      ) : (
        <BellOff className="h-5 w-5" />
      )}
    </Button>
  );
}
