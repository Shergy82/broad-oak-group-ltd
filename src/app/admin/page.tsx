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
              Upload an .xlsx file to schedule all tasks for one or more projects for one week.
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <strong>Multiple Projects:</strong> You can include multiple projects in a single sheet.
              </li>
              <li>
                <strong>Project Address:</strong> The full address for a project goes in the first column (Column A). This address will apply to all task rows below it until a new address is specified in Column A.
              </li>
              <li>
                <strong>Date Row:</strong> The importer will automatically find the row containing the week's dates (e.g., in DD/MM/YYYY format). This row must be above the task data.
              </li>
               <li>
                <strong>Task & Operative Cells:</strong> In the grid, each cell corresponding to a date should contain the task description, a hyphen, and the operative's full name.
                The format must be: <code>Task Description - Operative Name</code>. Spacing around the hyphen does not matter.
              </li>
              <li>
                <strong>Operative Name Matching:</strong> The operative's name in the sheet must exactly match their full name in the user list above.
              </li>
               <li>
                <strong>Shift Type:</strong> All imported tasks are automatically assigned as 'All Day' shifts.
              </li>
              <li>
                <strong>Ignored Cells:</strong> Any cells that are empty, do not contain a recognized 'Task - Name' format, or contain words like `holiday` or `on hold` will be skipped.
              </li>
            </ul>
            <p className="font-semibold pt-2">Example Structure:</p>
            <pre className="mt-2 rounded-md bg-muted p-4 text-xs font-mono overflow-x-auto">
{`+--------------------------------+----------------------------+--------------------------------+
| A (Address)                    | B (Date ->)                | C (Date ->)                    |
+--------------------------------+----------------------------+--------------------------------+
|                                | 09/06/2025                 | 10/06/2025                     |
+--------------------------------+----------------------------+--------------------------------+
| 9 Eardley Crescent...          | FIT TRAY - Phil Shergold   | STUD WALL... - Phil Shergold   |
+--------------------------------+----------------------------+--------------------------------+
|                                | TAKE OUT WINDOW - Phil S.  | TAKE OUT WINDOW - Phil S.      |
+--------------------------------+----------------------------+--------------------------------+
| 14 Oak Avenue...               | PLUMBING PREP - John Doe   | EXTERNAL PAINTING - Jane Smith |
+--------------------------------+----------------------------+--------------------------------+`}
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
