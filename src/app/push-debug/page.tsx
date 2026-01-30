
"use client";

import { usePushNotifications } from '@/hooks/use-push-notifications';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/shared/spinner';
import { useToast } from '@/hooks/use-toast';
import { useState } from 'react';
import { useAuth } from '@/hooks/use-auth';

const functionsBaseUrl = `https://europe-west2-${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}.cloudfunctions.net`;

export default function PushDebugPage() {
  const { user } = useAuth();
  const {
    isSupported,
    isSubscribed,
    isSubscribing,
    permission,
    isKeyLoading,
    vapidKey,
    subscribe,
    unsubscribe,
  } = usePushNotifications();

  const { toast } = useToast();
  const [isSending, setIsSending] = useState(false);

  const handleSendTest = async () => {
    if (!user) {
        toast({ title: "Not Authenticated", variant: 'destructive' });
        return;
    }
    setIsSending(true);
    try {
      const idToken = await user.getIdToken();
      const response = await fetch(`${functionsBaseUrl}/sendTestNotification`, {
          method: 'POST',
          headers: {
              'Authorization': `Bearer ${idToken}`
          }
      });
      const result = await response.json();
      if (!response.ok) {
          throw new Error(result.error || 'Failed to send test notification');
      }

      toast({
        title: 'Test Sent',
        description: result.message || 'Test notification sent from backend.',
      });
    } catch (error: any) {
      toast({
        title: 'Test Failed',
        description: error.message || 'Could not send test notification.',
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
          <CardDescription>Use this page to test the push notification system.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2 rounded-md border p-4">
            <h3 className="font-semibold">System Status</h3>
            <p><strong>Supported:</strong> {isSupported ? 'Yes' : 'No'}</p>
            <p><strong>Permission:</strong> {permission}</p>
            <p><strong>Subscribed:</strong> {isSubscribed ? 'Yes' : 'No'}</p>
            <p><strong>Key Loaded:</strong> {isKeyLoading ? 'Loading...' : vapidKey ? 'Yes' : 'No'}</p>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <Button onClick={subscribe} disabled={!isSupported || isSubscribed || isSubscribing || permission === 'denied'}>
              {isSubscribing && !isSubscribed ? <Spinner /> : 'Subscribe'}
            </Button>
            <Button onClick={unsubscribe} disabled={!isSubscribed || isSubscribing} variant="outline">
              {isSubscribing && isSubscribed ? <Spinner /> : 'Unsubscribe'}
            </Button>
          </div>

          <Button onClick={handleSendTest} disabled={!isSubscribed || isSending} className="w-full">
            {isSending ? <Spinner /> : 'Send Test Notification'}
          </Button>

        </CardContent>
      </Card>
    </div>
  );
}
