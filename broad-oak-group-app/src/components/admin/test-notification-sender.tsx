
'use client';

import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { db, functions, httpsCallable } from '@/lib/firebase';
import { collection, onSnapshot, query, addDoc, Timestamp, serverTimestamp } from 'firebase/firestore';
import type { UserProfile } from '@/types';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/shared/spinner';
import { Send } from 'lucide-react';
import { Label } from '@/components/ui/label';

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
      // This client-side write will trigger the `sendShiftNotification` onWrite function on the backend.
      await addDoc(collection(db, 'shifts'), {
        userId: selectedUserId,
        date: Timestamp.now(),
        type: 'all-day',
        status: 'pending-confirmation',
        address: 'Test Address',
        task: 'This is a test shift created to send a notification.',
        bNumber: 'B-TEST',
        createdAt: serverTimestamp(),
      });
      toast({ 
        title: 'Test Shift Created Successfully',
        description: 'The backend function has been triggered to send a notification. If it does not arrive, check your browser permissions.',
        duration: 10000,
      });
    } catch (error: any) {
      console.error('Error creating test shift:', error);
      if (error.code === 'permission-denied') {
        toast({
          variant: 'destructive',
          title: 'Permission Denied: Manual Fix Required',
          description: "Your database rules are blocking this. Please open your project's Firebase Console, go to Firestore > Rules, and replace the content with the text from the `firestore.rules` file in your project.",
          duration: 20000,
        });
      } else {
        toast({
          variant: 'destructive',
          title: 'Action Failed',
          description: `An unexpected error occurred: ${error.message || 'Unknown error'}`,
          duration: 10000,
        });
      }
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
