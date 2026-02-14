'use client';

import { useState } from 'react';
import { httpsCallable } from 'firebase/functions';

import { functions } from '@/lib/firebase';
import { usePushNotifications } from '@/hooks/use-push-notifications';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Spinner } from '@/components/shared/spinner';

/* =========================
   Callable
   ========================= */

const sendTestNotificationFn = httpsCallable<
  { uid: string },
  { ok: boolean; sent?: number; message?: string }
>(functions, 'sendTestNotificationHttp');

/* =========================
   Page
   ========================= */

export default function PushDebugPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isSending, setIsSending] = useState(false);

  const {
    isSupported,
    isSubscribed,
    isSubscribing,
    permission,
    vapidKey,
    subscribe,
    unsubscribe,
  } = usePushNotifications();

  const handleSendTest = async () => {
    if (!user) {
      toast({
        title: 'Not Authenticated',
        variant: 'destructive',
      });
      return;
    }

    setIsSending(true);

    try {
      const res = await sendTestNotificationFn({ uid: user.uid });

      if (!res.data?.ok) {
        throw new Error(res.data?.message || 'Test notification failed');
      }

      toast({
        title: 'Test Notification Sent',
        description:
          res.data.message ??
          (res.data.sent
            ? `Dispatched ${res.data.sent} notification(s).`
            : 'Notification dispatched.'),
      });
    } catch (err: any) {
      toast({
        title: 'Test Failed',
        description: err?.message || 'Could not send test notification.',
        variant: 'destructive',
      });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="container mx-auto max-w-2xl p-4 md:p-8">
      <Card>
        <CardHeader>
          <CardTitle>Push Notification Debug</CardTitle>
          <CardDescription>
            Use this page to test the push notification system.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="space-y-2 rounded-md border p-4">
            <h3 className="font-semibold">System Status</h3>

            <p>
              <strong>Supported:</strong> {isSupported ? 'Yes' : 'No'}
            </p>
            <p>
              <strong>Permission:</strong> {permission}
            </p>
            <p>
              <strong>Subscribed:</strong> {isSubscribed ? 'Yes' : 'No'}
            </p>
            <p>
              <strong>VAPID Key Loaded:</strong>{' '}
              {vapidKey ? 'Yes' : 'No'}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Button
              onClick={subscribe}
              disabled={
                !isSupported ||
                isSubscribed ||
                isSubscribing ||
                permission === 'denied'
              }
            >
              {isSubscribing && !isSubscribed ? <Spinner /> : 'Subscribe'}
            </Button>

            <Button
              onClick={unsubscribe}
              disabled={!isSubscribed || isSubscribing}
              variant="outline"
            >
              {isSubscribing && isSubscribed ? <Spinner /> : 'Unsubscribe'}
            </Button>
          </div>

          <Button
            onClick={handleSendTest}
            disabled={!isSubscribed || isSending}
            className="w-full"
          >
            {isSending ? <Spinner /> : 'Send Test Notification'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
