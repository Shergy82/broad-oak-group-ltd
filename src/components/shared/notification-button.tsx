
'use client';

import { usePushNotifications } from '@/hooks/use-push-notifications';
import { Button } from '@/components/ui/button';
import { Bell, BellRing, BellOff, Loader2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

export function NotificationButton() {
  const { isSubscribed, subscribe, unsubscribe, isLoading, permissionStatus } = usePushNotifications();

  const getButtonState = () => {
    if (isLoading) {
      return {
        icon: <Loader2 className="animate-spin" />,
        tooltip: 'Loading notification status...',
        disabled: true,
        action: () => {},
      };
    }
    if (permissionStatus === 'denied') {
        return {
          icon: <BellOff />,
          tooltip: 'Notifications blocked. Please enable them in your browser settings.',
          disabled: true,
          action: () => {},
        };
    }
    if (isSubscribed) {
      return {
        icon: <BellRing />,
        tooltip: 'You are subscribed to notifications. Click to unsubscribe.',
        disabled: false,
        action: unsubscribe,
      };
    }
    return {
      icon: <Bell />,
      tooltip: 'You are not subscribed. Click to receive notifications.',
      disabled: false,
      action: subscribe,
    };
  };

  const { icon, tooltip, disabled, action } = getButtonState();

  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return null;
  }
  
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={action}
            disabled={disabled}
            aria-label={tooltip}
          >
            {icon}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
