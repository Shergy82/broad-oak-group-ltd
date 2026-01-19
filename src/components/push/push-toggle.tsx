'use client';

import { useMemo } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { usePushNotifications } from '@/hooks/use-push-notifications';

export default function PushToggleButton() {
  const { toast } = useToast();
  const { isSupported, isSubscribed, isSubscribing, permission, subscribe, unsubscribe } =
    usePushNotifications();

  const label = useMemo(() => {
    if (!isSupported) return 'Push not supported';
    if (permission === 'denied') return 'Push blocked';
    return isSubscribed ? 'Notifications on' : 'Enable notifications';
  }, [isSupported, isSubscribed, permission]);

  const disabled = !isSupported || permission === 'denied' || isSubscribing;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      disabled={disabled}
      aria-label={label}
      title={label}
      onClick={async () => {
        try {
          if (!isSupported) {
            toast({
              title: 'Not supported',
              description: 'This browser does not support push notifications.',
              variant: 'destructive',
            });
            return;
          }
          if (permission === 'denied') {
            toast({
              title: 'Blocked',
              description: 'Notifications are blocked in your browser settings.',
              variant: 'destructive',
            });
            return;
          }

          if (isSubscribed) {
            await unsubscribe();
          } else {
            await subscribe();
          }
        } catch (e: any) {
          toast({
            title: 'Push error',
            description: e?.message || 'Something went wrong.',
            variant: 'destructive',
          });
        }
      }}
    >
      {isSubscribed ? <Bell className="h-5 w-5" /> : <BellOff className="h-5 w-5" />}
    </Button>
  );
}
