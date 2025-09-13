
'use client';

import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, doc, updateDoc } from 'firebase/firestore';
import { db, functions, httpsCallable } from '@/lib/firebase';
import type { UserProfile } from '@/types';
import { useUserProfile } from '@/hooks/use-user-profile';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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
import { Terminal, ShieldCheck, ShieldX, MoreHorizontal, UserCheck, UserX, Trash2, CheckCircle2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

export default function UserManagementPage() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionUser, setActionUser] = useState<UserProfile | null>(null);
  const [isDeleteAlertOpen, setDeleteAlertOpen] = useState(false);
  const { userProfile: currentUserProfile } = useUserProfile();
  const { toast } = useToast();

  useEffect(() => {
    if (!currentUserProfile || !db) {
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

  const executeUserAction = async (action: 'approve' | 'suspend' | 'reactivate' | 'delete', targetUser: UserProfile) => {
    if (!functions) {
        toast({ variant: 'destructive', title: 'Error', description: 'Functions service not available.' });
        return;
    }
     if (currentUserProfile?.role !== 'owner') {
        toast({ variant: 'destructive', title: 'Permission Denied', description: 'Only the owner can manage users.' });
        return;
    }
    
    let callableFunction;
    let payload;
    let successMessage = '';
    
    try {
        if (action === 'delete') {
            callableFunction = httpsCallable(functions, 'deleteUser');
            payload = { uid: targetUser.uid };
            successMessage = `User ${targetUser.name} has been permanently deleted.`;
        } else {
            callableFunction = httpsCallable(functions, 'setUserStatus');
            switch (action) {
                case 'approve':
                    payload = { uid: targetUser.uid, disabled: false, newStatus: 'active' };
                    successMessage = `User ${targetUser.name} has been approved.`;
                    break;
                case 'suspend':
                    payload = { uid: targetUser.uid, disabled: true, newStatus: 'suspended' };
                    successMessage = `User ${targetUser.name} has been suspended.`;
                    break;
                case 'reactivate':
                    payload = { uid: targetUser.uid, disabled: false, newStatus: 'active' };
                    successMessage = `User ${targetUser.name} has been reactivated.`;
                    break;
            }
        }
        
        await callableFunction(payload);
        
        toast({ title: 'Success', description: successMessage });

    } catch (error: any) {
        console.error(`Error performing action '${action}' on user:`, error);
        toast({ variant: 'destructive', title: 'Action Failed', description: error.message || 'An unexpected error occurred.'});
    } finally {
        if (action === 'delete') {
            setDeleteAlertOpen(false);
            setActionUser(null);
        }
    }
  };

  const handleRoleChange = async (userId: string, newRole: 'user' | 'admin' | 'owner') => {
    if (!db || currentUserProfile?.role !== 'owner') {
        toast({ variant: 'destructive', title: 'Permission Denied', description: 'Only the owner can change user roles.' });
        return;
    }
    const userDocRef = doc(db, 'users', userId);
    try {
      await updateDoc(userDocRef, { role: newRole });
      toast({ title: 'Success', description: "User role updated successfully." });
    } catch (error) {
      console.error("Error updating role:", error);
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to update user role.' });
    }
  };
  
  const isActionDisabled = (targetUser: UserProfile) => {
    if (!currentUserProfile) return true;
    // Only the owner can perform actions
    if (currentUserProfile.role !== 'owner') return true;
    // The owner cannot act on themselves
    if (currentUserProfile.uid === targetUser.uid) return true;
    // The owner cannot act on another owner
    if (targetUser.role === 'owner') return true;
    return false;
  }

  const renderRoleCell = (user: UserProfile) => {
    const roleMap: {[key: string]: string} = { 'user': 'User', 'admin': 'Admin', 'owner': 'Owner' };
    
    // Admins or users viewing themselves or other owners see a read-only badge.
    if (currentUserProfile?.role !== 'owner' || isActionDisabled(user)) {
      return (
        <Badge variant={user.role === 'owner' || user.role === 'admin' ? 'default' : 'secondary'} className="capitalize">
          {roleMap[user.role] || user.role}
        </Badge>
      );
    }
       
    // The owner can change roles for non-owner users.
    return (
        <Select
            defaultValue={user.role}
            onValueChange={(newRole: 'user' | 'admin') => handleRoleChange(user.uid, newRole)}
            disabled={isActionDisabled(user)}
        >
            <SelectTrigger className="w-[120px]">
              <SelectValue placeholder="Select role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="user">User</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
            </SelectContent>
        </Select>
    );
  }

  const getStatusBadge = (status?: 'active' | 'suspended' | 'pending-approval') => {
      switch (status) {
          case 'active':
              return <Badge className="bg-green-600 hover:bg-green-700">Active</Badge>
          case 'suspended':
              return <Badge variant="destructive">Suspended</Badge>
          case 'pending-approval':
              return <Badge variant="secondary" className="bg-amber-500 hover:bg-amber-600 text-white">Pending</Badge>
          default:
              return <Badge variant="outline">Unknown</Badge>
      }
  }

  return (
    <>
    <Card>
      <CardHeader>
        <CardTitle>User Management</CardTitle>
        <CardDescription>
            {currentUserProfile?.role === 'owner' 
                ? 'As the owner, you can view, assign roles, approve, and manage user accounts.' 
                : 'As an admin, you can view all users and their assigned roles.'
            }
        </CardDescription>
        {currentUserProfile?.role !== 'owner' && (
            <Alert className="mt-4">
                <ShieldX className="h-4 w-4" />
                <AlertTitle>Read-Only Access</AlertTitle>
                <AlertDescription>
                   Only the account owner can modify user roles or status.
                </AlertDescription>
            </Alert>
        )}
         {currentUserProfile?.role === 'owner' && (
            <Alert className="mt-4 border-primary/50 text-primary [&>svg]:text-primary">
                <ShieldCheck className="h-4 w-4" />
                <AlertTitle>Owner Privileges</AlertTitle>
                <AlertDescription>
                   You can assign roles, approve, suspend, or delete users. You cannot change your own role or the role of another owner.
                </AlertDescription>
            </Alert>
        )}
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
              <TableHead>Status</TableHead>
              { currentUserProfile?.role === 'owner' && <TableHead className="text-right">Actions</TableHead> }
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
                  <TableCell><Skeleton className="h-6 w-20" /></TableCell>
                  { currentUserProfile?.role === 'owner' && <TableCell><Skeleton className="h-10 w-10 ml-auto" /></TableCell> }
                </TableRow>
              ))
            ) : (
              users.map((user) => (
                <TableRow key={user.uid} className={user.status === 'suspended' ? 'bg-muted/30' : ''}>
                  <TableCell className="font-medium">{user.name}</TableCell>
                  <TableCell>{user.createdAt?.toDate().toLocaleDateString() ?? 'N/A'}</TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>{user.phoneNumber}</TableCell>
                  <TableCell>{renderRoleCell(user)}</TableCell>
                  <TableCell>
                      {getStatusBadge(user.status)}
                  </TableCell>
                   {currentUserProfile?.role === 'owner' && (
                     <TableCell className="text-right">
                        {!isActionDisabled(user) && (
                             <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" className="h-8 w-8 p-0">
                                        <span className="sr-only">Open menu</span>
                                        <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                    <DropdownMenuSeparator />
                                    {user.status === 'pending-approval' && (
                                        <DropdownMenuItem onClick={() => executeUserAction('approve', user)}>
                                            <CheckCircle2 className="mr-2 h-4 w-4" />
                                            Approve User
                                        </DropdownMenuItem>
                                    )}
                                    {user.status === 'suspended' ? (
                                        <DropdownMenuItem onClick={() => executeUserAction('reactivate', user)}>
                                            <UserCheck className="mr-2 h-4 w-4" />
                                            Reactivate User
                                        </DropdownMenuItem>
                                    ) : user.status === 'active' && (
                                        <DropdownMenuItem onClick={() => executeUserAction('suspend', user)}>
                                            <UserX className="mr-2 h-4 w-4" />
                                            Suspend User
                                        </DropdownMenuItem>
                                    )}
                                    <DropdownMenuItem className="text-destructive" onClick={() => { setActionUser(user); setDeleteAlertOpen(true); }}>
                                        <Trash2 className="mr-2 h-4 w-4" />
                                        Delete User
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        )}
                     </TableCell>
                   )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
    
    <AlertDialog open={isDeleteAlertOpen} onOpenChange={setDeleteAlertOpen}>
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                <AlertDialogDescription>
                    This action cannot be undone. This will permanently delete the account for <span className="font-bold">{actionUser?.name}</span> and all of their associated data. They will no longer be able to log in.
                </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
                <AlertDialogCancel onClick={() => setActionUser(null)}>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => actionUser && executeUserAction('delete', actionUser)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    Yes, Delete User
                </AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
    </AlertDialog>

    </>
  );
}
