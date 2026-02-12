'use client';

import { usePushNotifications } from '@/hooks/use-push-notifications';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/shared/spinner';
import { useAuth } from '@/hooks/use-auth';
import { TestNotificationSender } from '@/components/admin/test-notification-sender';

function SubscriptionManager() {
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>My Subscription</CardTitle>
        <CardDescription>
          Manage push notification subscription for this device and browser. To test on your iPhone, visit this page on your iPhone.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2 rounded-md border p-4">
          <h3 className="font-semibold">Device Status</h3>
          <p><strong>Supported:</strong> {isSupported ? 'Yes' : 'No'}</p>
          <p><strong>Permission:</strong> {permission}</p>
          <p><strong>Subscribed:</strong> {isSubscribed ? 'Yes' : 'No'}</p>
          <p>
            <strong>VAPID Key:</strong>{' '}
            {isKeyLoading ? 'Loading...' : vapidKey ? 'Loaded' : 'Not Loaded'}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Button
            onClick={subscribe}
            disabled={!isSupported || isSubscribed || isSubscribing || permission === 'denied'}
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
      </CardContent>
    </Card>
  );
}

export default function NotificationsAdminPage() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <Spinner size="lg" />;
  }
  if (!user) {
    return <p>Please log in.</p>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Notification Center</h1>
      <SubscriptionManager />
      <TestNotificationSender />
    </div>
  );
}
