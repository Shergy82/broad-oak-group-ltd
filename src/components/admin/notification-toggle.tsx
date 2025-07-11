'use client';

import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db, functions, httpsCallable } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/shared/spinner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { BellOff, BellRing } from 'lucide-react';

export function NotificationToggle() {
  const [isEnabled, setIsEnabled] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    if (!db) {
      setIsLoading(false);
      return;
    }
    const settingsRef = doc(db, 'settings', 'notifications');
    const unsubscribe = onSnapshot(settingsRef, (docSnap) => {
      if (docSnap.exists() && docSnap.data().enabled === false) {
        setIsEnabled(false);
      } else {
        // Default to enabled if doc doesn't exist or field is true/missing
        setIsEnabled(true);
      }
      setIsLoading(false);
    }, (error) => {
      console.error("Error fetching notification settings:", error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Could not load notification settings. Please check Firestore rules.',
      });
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [toast]);

  const handleToggle = async (checked: boolean) => {
    if (!functions) {
        toast({ variant: 'destructive', title: 'Error', description: 'Functions service not available.' });
        return;
    };
    setIsLoading(true);

    try {
      const setNotificationStatus = httpsCallable<{ enabled: boolean }, { success: boolean }>(functions, 'setNotificationStatus');
      await setNotificationStatus({ enabled: checked });
      // The onSnapshot listener will update the state automatically,
      // but we can set it here for a faster UI response.
      setIsEnabled(checked);
      toast({
        title: 'Settings Updated',
        description: `Notifications are now globally ${checked ? 'ENABLED' : 'DISABLED'}.`,
      });
    } catch (error: any) {
      console.error("Error updating notification settings:", error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'Could not update settings.',
      });
    } finally {
      // Let the snapshot listener handle the final loading state
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Global Notification Control</CardTitle>
        <CardDescription>
          Use this master switch to temporarily enable or disable ALL push notifications for all users.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2">
            <Spinner /> Loading settings...
          </div>
        ) : (
          <div>
            <div className="flex items-center space-x-4 rounded-md border p-4">
               <div className="flex-1 space-y-1">
                 <Label htmlFor="notification-toggle" className="text-base font-medium">
                   Push Notifications
                 </Label>
                 <p className="text-sm text-muted-foreground">
                   Turn this off to prevent the system from sending any shift-related notifications.
                 </p>
               </div>
               <Switch
                 id="notification-toggle"
                 checked={isEnabled}
                 onCheckedChange={handleToggle}
                 aria-readonly
               />
            </div>
            <Alert variant={isEnabled ? 'default' : 'destructive'} className="mt-4">
                {isEnabled ? <BellRing className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
                <AlertTitle>{isEnabled ? 'Notifications are ENABLED' : 'Notifications are DISABLED'}</AlertTitle>
                <AlertDescription>
                    {isEnabled 
                        ? 'The system will send notifications for new, updated, or cancelled shifts.' 
                        : 'No users will receive push notifications until this is turned back on.'}
                </AlertDescription>
            </Alert>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
