
'use client';

import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, query } from 'firebase/firestore';
import type { UserProfile } from '@/types';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { sendTestShiftNotificationAction } from '@/app/admin/actions';
import { Spinner } from '../shared/spinner';
import { Send } from 'lucide-react';
import { Label } from '../ui/label';

export function TestNotificationSender() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingUsers, setIsFetchingUsers] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    if (!db) {
        setIsFetchingUsers(false);
        return;
    }
    const usersQuery = query(collection(db, 'users'));
    const unsubscribe = onSnapshot(usersQuery, (snapshot) => {
      const fetchedUsers: UserProfile[] = [];
      snapshot.forEach((doc) => {
        fetchedUsers.push({ uid: doc.id, ...doc.data() } as UserProfile);
      });
      setUsers(fetchedUsers.sort((a, b) => a.name.localeCompare(b.name)));
      setIsFetchingUsers(false);
    }, (error) => {
      console.error("Error fetching users:", error);
      toast({ variant: 'destructive', title: 'Error', description: 'Could not fetch users.' });
      setIsFetchingUsers(false);
    });
    return () => unsubscribe();
  }, [toast]);

  const handleSendTest = async () => {
    if (!selectedUserId) {
      toast({ variant: 'destructive', title: 'No User Selected', description: 'Please select a user to send a notification to.' });
      return;
    }
    setIsLoading(true);
    try {
      const result = await sendTestShiftNotificationAction(selectedUserId);
      if (result.success) {
        toast({ title: 'Test Shift Created', description: `A test notification will be sent to the selected user shortly.` });
      } else {
        throw new Error(result.error);
      }
    } catch (error: any) {
      console.error('Error sending test notification:', error);
      let errorMessage = 'Failed to create test shift.';
      if (error.message && error.message.includes('PERMISSION_DENIED')) {
          errorMessage = "Permission Denied. Your security rules are blocking this action. Please deploy the new rules by running `npx firebase deploy --only firestore` in the terminal.";
      } else if (error.message) {
          errorMessage = error.message;
      }
      toast({ variant: 'destructive', title: 'Error Creating Test Shift', description: errorMessage });
    } finally {
      setIsLoading(false);
    }
  };
  
  if (isFetchingUsers) {
      return (
        <Card>
            <CardHeader>
                <CardTitle>Send a Test Notification</CardTitle>
                <CardDescription>This will create a new "Test Shift" in the database, which triggers the notification function.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="flex items-center justify-center h-24">
                    <Spinner />
                </div>
            </CardContent>
        </Card>
      );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Send a Test Notification</CardTitle>
        <CardDescription>
          This creates a temporary "Test Shift" assigned to the selected user. The creation of this shift will trigger the push notification function.
          The user must have already subscribed to notifications in their browser to receive it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
            <Label htmlFor="user-select">Select User</Label>
            <Select onValueChange={setSelectedUserId} value={selectedUserId}>
              <SelectTrigger id="user-select" className="max-w-sm">
                <SelectValue placeholder="Select a user to notify..." />
              </SelectTrigger>
              <SelectContent>
                {users.map((user) => (
                  <SelectItem key={user.uid} value={user.uid}>
                    {user.name} ({user.email})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
        </div>
        <Button onClick={handleSendTest} disabled={isLoading || !selectedUserId}>
          {isLoading ? <Spinner /> : <><Send className="mr-2"/> Send Test Notification</>}
        </Button>
      </CardContent>
    </Card>
  );
}
