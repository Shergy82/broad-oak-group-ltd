
'use client';

import { useState } from 'react';
import { usePushNotifications } from '@/hooks/use-push-notifications';
import { Button } from '../ui/button';
import { Bell, BellOff, XCircle, Settings } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { Spinner } from './spinner';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export function NotificationButton() {
  const {
    isSupported,
    isSubscribed,
    isSubscribing,
    permission,
    subscribe,
    unsubscribe,
  } = usePushNotifications();

  const [isBlockedDialogOpen, setBlockedDialogOpen] = useState(false);

  if (!isSupported) {
    return null;
  }
  
  const handleToggleSubscription = () => {
    if (permission === 'denied') {
      setBlockedDialogOpen(true);
    } else if (isSubscribed) {
      unsubscribe();
    } else {
      subscribe();
    }
  };

  const getIcon = () => {
    if (isSubscribing) return <Spinner />;
    if (permission === 'denied') return <XCircle className="h-5 w-5 text-destructive" />;
    if (isSubscribed) return <Bell className="h-5 w-5 text-green-600" />;
    return <BellOff className="h-5 w-5 text-muted-foreground" />;
  };

  const getTooltipContent = () => {
    if (isSubscribing) return 'Updating subscription...';
    if (permission === 'denied') return 'Notifications blocked by browser';
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
              disabled={isSubscribing}
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
                To receive notifications about your shifts, you need to manually enable them in your browser's settings.
              </p>
              <p className="mt-4 text-sm font-semibold">How to fix this:</p>
              <ul className="list-decimal pl-5 mt-2 space-y-1 text-muted-foreground text-sm">
                <li>Go to your browser's settings page (e.g., Chrome, Firefox, Safari).</li>
                <li>Find the "Site Settings" or "Permissions" section.</li>
                <li>Look for this website and change the "Notifications" permission to "Allow".</li>
                <li>Refresh this page after changing the setting.</li>
              </ul>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setBlockedDialogOpen(false)}>Close</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
