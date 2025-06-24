'use client';

import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { UserProfile } from '@/types';
import { useUserProfile } from '@/hooks/use-user-profile';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { FileUploader } from '@/components/admin/file-uploader';
import { mockUsers } from '@/lib/mock-data';

export default function AdminPage() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const { userProfile: currentUserProfile } = useUserProfile();
  const { toast } = useToast();

  useEffect(() => {
    if (!db) {
      setUsers(mockUsers);
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
      
      if (fetchedUsers.length === 0) {
        setUsers(mockUsers);
      } else {
        setUsers(fetchedUsers.sort((a, b) => a.name.localeCompare(b.name)));
      }
      setLoading(false);
    }, (error) => {
      console.error("Error fetching users: ", error);
      toast({
        variant: 'destructive',
        title: 'Permission Error',
        description: "Could not fetch the user list. This is a Firestore security rule issue. Please ensure your rules in the Firebase Console match the latest version provided. Also, verify that your logged-in user has a document in the 'users' collection with the 'role' field correctly set to 'owner' or 'admin'.",
      });
      setUsers(mockUsers);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [toast]);

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
    // Admins cannot change other admins' roles
    if (currentUserProfile.role === 'admin' && targetUser.role === 'admin') return true;

    return false;
  }

  return (
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <CardTitle>User Management</CardTitle>
          <CardDescription>View and manage user roles and permissions.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone Number</TableHead>
                <TableHead>Role</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i} className={i % 2 === 0 ? 'bg-muted/50' : ''}>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                    <TableCell><Skeleton className="h-10 w-32" /></TableCell>
                  </TableRow>
                ))
              ) : (
                users.map((user, i) => (
                  <TableRow key={user.uid} className={i % 2 === 0 ? 'bg-muted/50' : ''}>
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
                          <SelectItem value="admin" disabled={currentUserProfile?.role !== 'owner'}>Admin</SelectItem>
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
      <Card>
        <CardHeader>
          <CardTitle>Import Weekly Shifts from Excel</CardTitle>
           <div className="text-sm text-muted-foreground space-y-2 pt-1">
            <p>
              Upload an .xlsx file to schedule shifts for multiple operatives. The file must be structured as a grid.
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <strong>Date Row:</strong> The importer automatically finds the row containing the week's dates (e.g., in DD/MM/YYYY format). This row can be anywhere in the sheet.
              </li>
              <li>
                <strong>Operative Rows:</strong> Each row after the date row represents an operative's schedule.
                <ul className="list-disc pl-5 mt-1">
                  <li>
                    <strong>Column A:</strong> Must contain the operative's full name (as it appears in the user list), followed by a space and the shift type: `ALL DAY`, `AM`, or `PM`. Example: `John Doe ALL DAY`.
                  </li>
                  <li>
                    <strong>Columns B-H:</strong> These columns correspond to the dates. The text in these cells becomes the job address for that day.
                  </li>
                </ul>
              </li>
              <li>
                <strong>Ignored Cells:</strong> Any cells that are empty or contain only `***` will be skipped.
              </li>
            </ul>
            <p className="font-semibold pt-2">Example Structure:</p>
            <pre className="mt-2 rounded-md bg-muted p-4 text-xs font-mono overflow-x-auto">
{`+------------------------+----------------+----------------+----------------+
|        A               |        B       |        C       |        D       |
+------------------------+----------------+----------------+----------------+
|                        | 16/06/2025     | 17/06/2025     | 18/06/2025     |
+------------------------+----------------+----------------+----------------+
| John Doe ALL DAY       | 123 Main St    | 456 Oak Ave    |                |
+------------------------+----------------+----------------+----------------+
| Alice Johnson AM       |                | 789 Pine Ln    | Site Visit     |
+------------------------+----------------+----------------+----------------+
| Jane Smith (Admin) PM  | ***            |                | 111 Elm St     |
+------------------------+----------------+----------------+----------------+`}
            </pre>
          </div>
        </CardHeader>
        <CardContent>
          <FileUploader />
        </CardContent>
      </Card>
    </div>
  );
}
