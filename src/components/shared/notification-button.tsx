
'use client';

import { usePushNotifications } from '@/hooks/use-push-notifications';
import { Button } from '@/components/ui/button';
import { Bell, BellOff, Loader2 } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function NotificationButton() {
  const { isSupported, isSubscribed, isSubscribing, subscribe, unsubscribe } = usePushNotifications();

  if (!isSupported) {
    return null; // Don't render if push notifications aren't supported
  }

  const handleToggleSubscription = () => {
    if (isSubscribed) {
      unsubscribe();
    } else {
      subscribe();
    }
  };

  const getTooltipContent = () => {
    if (isSubscribing) return "Please wait...";
    return isSubscribed ? "Unsubscribe from notifications" : "Subscribe to notifications";
  };
  
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleToggleSubscription}
              disabled={isSubscribing}
              aria-label={getTooltipContent()}
            >
              {isSubscribing ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : isSubscribed ? (
                <Bell className="h-5 w-5 text-accent" />
              ) : (
                <BellOff className="h-5 w-5 text-muted-foreground" />
              )}
            </Button>
        </TooltipTrigger>
        <TooltipContent>
            <p>{getTooltipContent()}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
