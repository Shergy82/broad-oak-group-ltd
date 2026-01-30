
'use client';

import { useState } from 'react';
import { usePushNotifications } from '@/hooks/use-push-notifications';
import { Button } from '../ui/button';
import { Bell, BellOff, XCircle, Settings, AlertTriangle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { Spinner } from './spinner';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export function NotificationButton() {
  const {
    isSupported,
    isSubscribed,
    isSubscribing,
    isKeyLoading,
    vapidKey,
    permission,
    subscribe,
    unsubscribe,
  } = usePushNotifications();

  const [isBlockedDialogOpen, setBlockedDialogOpen] = useState(false);

  if (!isSupported) {
    return null;
  }

  const vapidMissing = !isKeyLoading && !vapidKey;

  const handleToggleSubscription = () => {
    if (permission === 'denied') {
      setBlockedDialogOpen(true);
      return;
    }

    if (isSubscribed) {
      unsubscribe();
    } else {
      subscribe();
    }
  };

  const getIcon = () => {
    if (isKeyLoading || isSubscribing) return <Spinner />;
    if (permission === 'denied') return <XCircle className="h-5 w-5 text-destructive" />;
    if (vapidMissing) return <AlertTriangle className="h-5 w-5 text-destructive" />;
    if (isSubscribed) return <Bell className="h-5 w-5 text-green-600" />;
    return <BellOff className="h-5 w-5 text-muted-foreground" />;
  };

  const getTooltipContent = () => {
    if (isKeyLoading) return 'Loading notification settings...';
    if (permission === 'denied') return 'Notifications blocked in browser settings';
    if (vapidMissing) return 'VAPID key not configured (cannot subscribe)';
    if (isSubscribed) return 'Unsubscribe from notifications';
    return 'Subscribe to notifications';
  };

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleToggleSubscription}
              disabled={isKeyLoading || isSubscribing || vapidMissing}
              aria-label="Notifications"
            >
              {getIcon()}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{getTooltipContent()}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <AlertDialog open={isBlockedDialogOpen} onOpenChange={setBlockedDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Settings />
              Notifications Blocked
            </AlertDialogTitle>
            <AlertDialogDescription className="pt-2">
              <p>You have previously blocked notifications for this site.</p>
              <p className="mt-2">
                To receive notifications about your shifts, you need to manually enable them in your browser&apos;s settings.
              </p>
              <p className="mt-4 text-sm font-semibold">How to fix this:</p>
              <ul className="list-decimal pl-5 mt-2 space-y-1 text-muted-foreground text-sm">
                <li>Go to your browser&apos;s settings page (Chrome / Edge / Safari).</li>
                <li>Find “Site settings” / “Permissions”.</li>
                <li>Find this website and change Notifications from Block to Allow.</li>
                <li>Refresh the page.</li>
              </ul>
            </AlertDialogDescription>
          </AlertDialogHeader>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
