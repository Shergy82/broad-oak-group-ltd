'use client';

import { useEffect, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/shared/spinner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Lock, Unlock } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useUserProfile } from '@/hooks/use-user-profile';

const APP_STATUS_DOC_ID = 'app_status';

export function AppStatusToggle() {
  const [isLocked, setIsLocked] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [targetState, setTargetState] = useState(false);
  const { toast } = useToast();
  const { userProfile } = useUserProfile();

  useEffect(() => {
    const docRef = doc(db, 'settings', APP_STATUS_DOC_ID);
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        setIsLocked(docSnap.data().isLocked || false);
      } else {
        // Default to unlocked if the document doesn't exist
        setIsLocked(false);
      }
      setIsLoading(false);
    }, (error) => {
      console.error("Error fetching app status:", error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Could not load app status settings.',
      });
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [toast]);

  if (userProfile?.email !== 'phil.s@broadoakgroup.com') {
      return null;
  }

  const handleToggleAttempt = (checked: boolean) => {
    setTargetState(checked);
    setIsConfirmOpen(true);
  };

  const handleConfirmToggle = async () => {
    setIsLoading(true);
    try {
      const docRef = doc(db, 'settings', APP_STATUS_DOC_ID);
      await setDoc(docRef, { isLocked: targetState }, { merge: true });
      setIsLocked(targetState);
      toast({
        title: 'App Status Updated',
        description: `The application is now ${targetState ? 'LOCKED' : 'UNLOCKED'}.`,
      });
    } catch (error: any) {
      console.error("Error updating app status:", error);
      toast({
        variant: 'destructive',
        title: 'Update Failed',
        description: error.message || 'Could not update app status.',
      });
    } finally {
      setIsLoading(false);
      setIsConfirmOpen(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Application Kill Switch</CardTitle>
          <CardDescription>
            This master switch will immediately lock or unlock the application for everyone except Phil Shergold.
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
                  <Label htmlFor="lock-toggle" className="text-base font-medium">
                    Lock Application
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    When turned on, only Phil Shergold can access the application.
                  </p>
                </div>
                <Switch
                  id="lock-toggle"
                  checked={isLocked}
                  onCheckedChange={handleToggleAttempt}
                  aria-readonly
                />
              </div>
              <Alert variant={isLocked ? 'destructive' : 'default'} className="mt-4">
                {isLocked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                <AlertTitle>{isLocked ? 'Application is LOCKED' : 'Application is UNLOCKED'}</AlertTitle>
                <AlertDescription>
                  {isLocked
                    ? 'Everyone except Phil Shergold will be blocked from accessing the app.'
                    : 'All users can access the app normally.'}
                </AlertDescription>
              </Alert>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to {targetState ? 'LOCK' : 'UNLOCK'} the application for everyone.
              {targetState ? ' Users will be immediately logged out or blocked.' : ' All users will regain access immediately.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmToggle}
              className={targetState ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : ''}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
