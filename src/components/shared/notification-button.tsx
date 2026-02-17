'use client';

import { Bell, BellOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { usePushNotifications } from '@/hooks/use-push-notifications';

export function NotificationButton() {
  const { isSupported, isSubscribed, subscribe, unsubscribe } =
    usePushNotifications();

  if (!isSupported) return null;

  const handleClick = () => {
    if (isSubscribed) {
      unsubscribe();
    } else {
      subscribe();
    }
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleClick}
            aria-label="Toggle notifications"
          >
            {isSubscribed ? (
              <Bell className="h-5 w-5 text-green-600" />
            ) : (
              <BellOff className="h-5 w-5 text-muted-foreground" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{isSubscribed ? 'Disable notifications' : 'Enable notifications'}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
