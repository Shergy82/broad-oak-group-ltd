'use client';

import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { UserProfile } from '@/types';
import { useUserProfile } from '@/hooks/use-user-profile';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Terminal } from 'lucide-react';

export default function UserManagementPage() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const { userProfile: currentUserProfile } = useUserProfile();
  const { toast } = useToast();

  useEffect(() => {
    // The parent admin layout already handles loading state, so we just wait for a profile.
    if (!currentUserProfile) return;

    // Only fetch users if the current user is an owner.
    if (currentUserProfile.role !== 'owner') {
      setLoading(false);
      return;
    }
    
    if (!db) {
      setUsers([]);
      setLoading(false);
      return;
    }
    const usersCollection = collection(db, 'users');
    const q = query(usersCollection);

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const fetchedUsers: UserProfile[] = [];
      querySnapshot.forEach((doc) => {
        fetchedUsers.push({ uid: doc.id, ...doc.data() } as UserProfile);
      });
      setUsers(fetchedUsers.sort((a, b) => a.name.localeCompare(b.name)));
      setLoading(false);
    }, (error) => {
      console.error("Error fetching users: ", error);
      toast({
        variant: 'destructive',
        title: 'Permission Error',
        description: "Could not fetch user list. Please check Firestore security rules.",
      });
      setUsers([]);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUserProfile, toast]);

  const handleRoleChange = async (userId: string, newRole: 'user' | 'admin' | 'owner') => {
    if (!db) return;
    const userDocRef = doc(db, 'users', userId);
    try {
      await updateDoc(userDocRef, { role: newRole });
      toast({
        title: 'Success',
        description: "User role updated successfully.",
      });
    } catch (error) {
      console.error("Error updating role:", error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to update user role. Check Firestore security rules.',
      });
    }
  };
  
  const isRoleChangeDisabled = (targetUser: UserProfile) => {
    if (!currentUserProfile) return true;
    // Cannot change your own role
    if (currentUserProfile.uid === targetUser.uid) return true;
    // The designated owner's role cannot be changed
    if (targetUser.role === 'owner') return true;
    // Admins cannot change other admins' roles (though only owners can see this page now)
    if (currentUserProfile.role === 'admin' && targetUser.role === 'admin') return true;

    return false;
  }

  // The AdminLayout handles initial loading, but we add our role check here.
  // currentUserProfile is guaranteed to be loaded by the parent layout.
  if (currentUserProfile && currentUserProfile.role !== 'owner') {
      return (
          <Alert variant="destructive">
              <Terminal className="h-4 w-4" />
              <AlertTitle>Access Denied</AlertTitle>
              <AlertDescription>
                  You do not have the required permissions to view this page. Access is restricted to the account owner.
              </AlertDescription>
          </Alert>
      );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>User Management</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Date Joined</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Phone Number</TableHead>
              <TableHead>Role</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                  <TableCell><Skeleton className="h-10 w-32" /></TableCell>
                </TableRow>
              ))
            ) : (
              users.map((user) => (
                <TableRow key={user.uid}>
                  <TableCell className="font-medium">{user.name}</TableCell>
                  <TableCell>{user.createdAt?.toDate().toLocaleDateString() ?? 'N/A'}</TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>{user.phoneNumber}</TableCell>
                  <TableCell>
                    <Select
                      defaultValue={user.role}
                      onValueChange={(newRole: 'user' | 'admin') => handleRoleChange(user.uid, newRole)}
                      disabled={isRoleChangeDisabled(user)}
                    >
                      <SelectTrigger className="w-[120px]">
                        <SelectValue placeholder="Select role" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="user">User</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
