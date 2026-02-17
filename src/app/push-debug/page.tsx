'use client';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { usePushNotifications } from '@/hooks/use-push-notifications';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { useState } from 'react';

export default function PushDebugPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { isSupported, isSubscribed, subscribe, unsubscribe } =
    usePushNotifications();

  const [sending, setSending] = useState(false);

  const sendTest = async () => {
    if (!user) {
      toast({ title: 'Not logged in', variant: 'destructive' });
      return;
    }

    setSending(true);
    try {
      const res = await fetch(
        `https://europe-west2-the-final-project-5e248.cloudfunctions.net/sendTestNotificationHttp?uid=${encodeURIComponent(
          user.uid
        )}`
      );
      const data = await res.json();

      if (!res.ok) throw new Error(data?.error || 'Send failed');

      toast({
        title: 'Test notification sent',
        description: data.message || 'Success',
      });
    } catch (err: any) {
      toast({
        title: 'Test failed',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="container mx-auto max-w-xl p-6">
      <Card>
        <CardHeader>
          <CardTitle>Push Debug</CardTitle>
          <CardDescription>
            This page verifies push subscription and delivery.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p>
            <strong>Supported:</strong> {isSupported ? 'Yes' : 'No'}
          </p>
          <p>
            <strong>Subscribed:</strong> {isSubscribed ? 'Yes' : 'No'}
          </p>

          <div className="flex gap-3">
            <Button onClick={subscribe} disabled={!isSupported || isSubscribed}>
              Subscribe
            </Button>
            <Button
              onClick={unsubscribe}
              disabled={!isSubscribed}
              variant="outline"
            >
              Unsubscribe
            </Button>
          </div>

          <Button
            onClick={sendTest}
            disabled={!isSubscribed || sending}
            className="w-full"
          >
            {sending ? 'Sending…' : 'Send Test Notification'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
