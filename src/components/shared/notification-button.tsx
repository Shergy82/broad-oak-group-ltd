'use client';

import { usePushNotifications } from '@/hooks/use-push-notifications';
import { Button } from '../ui/button';
import { Bell, BellOff } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { Spinner } from './spinner';

export function NotificationButton() {
  const {
    isSupported,
    isSubscribed,
    isSubscribing,
    permission,
    subscribe,
    unsubscribe,
  } = usePushNotifications();
  
  if (!isSupported) {
    return null; // Don't render the button if push is not supported at all.
  }

  const handleToggle = () => {
    if (isSubscribed) {
      unsubscribe();
    } else {
      subscribe();
    }
  };

  const getIcon = () => {
    if (isSubscribing) return <Spinner />;
    if (isSubscribed) return <Bell className="h-5 w-5 text-green-600" />;
    return <BellOff className="h-5 w-5 text-muted-foreground" />;
  };

  const getTooltipContent = () => {
    if (permission === 'denied') return 'Notifications blocked in browser settings';
    if (isSubscribing) return 'Please wait...';
    if (isSubscribed) return 'Unsubscribe from notifications';
    return 'Subscribe to notifications';
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleToggle}
            disabled={isSubscribing || permission === 'denied'}
            aria-label="Toggle Notifications"
          >
            {getIcon()}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{getTooltipContent()}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
