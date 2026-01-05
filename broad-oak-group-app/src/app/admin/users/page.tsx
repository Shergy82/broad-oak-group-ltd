
'use client';

import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, doc, updateDoc } from 'firebase/firestore';
import { db, functions } from '@/lib/firebase';
import { httpsCallable } from 'firebase/functions';
import type { UserProfile } from '@/types';
import { useUserProfile } from '@/hooks/use-user-profile';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Download, Users, Trash2, RefreshCcw } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { format } from 'date-fns';
import { Input } from '@/components/ui/input';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Spinner } from '@/components/shared/spinner';


export default function UserManagementPage() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const { userProfile: currentUserProfile } = useUserProfile();
  const { toast } = useToast();
  
  const isOwner = currentUserProfile?.role === 'owner';
  const isPrivilegedUser = isOwner || currentUserProfile?.role === 'admin';

  useEffect(() => {
    if (!currentUserProfile || !db) {
      setUsers([]);
      setLoading(false);
      return;
    }

    const usersCollection = collection(db, 'users');
    const q = query(usersCollection);

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      let employmentTypes: { [key: string]: 'direct' | 'subbie' } = {};
      if (typeof window !== 'undefined') {
        const storedTypes = localStorage.getItem('employmentTypes');
        if (storedTypes) {
          employmentTypes = JSON.parse(storedTypes);
        }
      }

      const fetchedUsers: UserProfile[] = [];
      querySnapshot.forEach((doc) => {
        const user = { uid: doc.id, ...doc.data() } as UserProfile;
        // Apply locally stored type if it exists
        if (employmentTypes[user.uid]) {
            user.employmentType = employmentTypes[user.uid];
        }
        fetchedUsers.push(user);
      });
      setUsers(fetchedUsers.sort((a, b) => a.name.localeCompare(b.name)));
      setLoading(false);
    }, (error) => {
      console.error("Error fetching users: ", error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: "Could not fetch user list. Please check permissions.",
      });
      setUsers([]);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUserProfile, toast]);
  
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

  const handleOperativeIdChange = async (uid: string, operativeId: string) => {
    if (!isPrivilegedUser) {
        toast({ variant: "destructive", title: "Permission Denied", description: "You cannot change the Operative ID." });
        return;
    }
    if (!db) {
      toast({ variant: 'destructive', title: 'Database not configured' });
      return;
    }
    const userDocRef = doc(db, 'users', uid);
    try {
        await updateDoc(userDocRef, { operativeId });
        toast({ title: "Success", description: "Operative ID updated." });
    } catch (error: any) {
        toast({ variant: "destructive", title: "Update Failed", description: error.message || "Could not update Operative ID." });
    }
  };

  const handleEmploymentTypeChange = (uid: string, employmentType: 'direct' | 'subbie') => {
    // Update the state for immediate UI feedback
    setUsers(currentUsers =>
      currentUsers.map(user =>
        user.uid === uid ? { ...user, employmentType: employmentType } : user
      )
    );

    // Persist to localStorage
    if (typeof window !== 'undefined') {
        const storedTypes = localStorage.getItem('employmentTypes');
        const employmentTypes = storedTypes ? JSON.parse(storedTypes) : {};
        employmentTypes[uid] = employmentType;
        localStorage.setItem('employmentTypes', JSON.stringify(employmentTypes));
    }
    
    toast({
        title: "Employment Type Saved (Locally)",
        description: "This choice is saved in your browser and will be remembered."
    });
  };
  
  const handleDownloadPdf = async () => {
    const { default: jsPDF } = await import('jspdf');
    const { default: autoTable } = await import('jspdf-autotable');

    const doc = new jsPDF();
    const generationDate = new Date();
    
    doc.setFontSize(18);
    doc.text(`User Directory`, 14, 22);
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(`Generated on: ${format(generationDate, 'PPP p')}`, 14, 28);
    
    let finalY = 35;

    const generateTableForType = (title: string, userList: UserProfile[]) => {
      if (userList.length === 0) return;
      
      doc.setFontSize(16);
      doc.text(title, 14, finalY);
      finalY += 8;

      autoTable(doc, {
        head: [['ID', 'Name', 'Email', 'Phone Number']],
        body: userList.map(u => [
            u.operativeId || 'N/A', 
            u.name, 
            u.email, 
            u.phoneNumber
        ]),
        startY: finalY,
        headStyles: { fillColor: [6, 95, 212] },
        didDrawPage: (data) => {
            finalY = data.cursor?.y || 0;
        }
      });
      finalY = (doc as any).lastAutoTable.finalY + 15;
    };
    
    const isOperative = (u: UserProfile) => !['admin', 'owner'].includes(u.role);

    const directUsers = users.filter(u => u.employmentType === 'direct' && isOperative(u));
    const subbieUsers = users.filter(u => u.employmentType === 'subbie' && isOperative(u));
    const unassignedUsers = users.filter(u => !u.employmentType && isOperative(u));

    generateTableForType('Direct Employees', directUsers);
    generateTableForType('Subcontractors (Subbies)', subbieUsers);
    generateTableForType('Unassigned', unassignedUsers);
    
    doc.save(`user_directory_${format(generationDate, 'yyyy-MM-dd')}.pdf`);
  };

  const handleUserStatusChange = async (uid: string, currentStatus: 'active' | 'suspended' | 'pending-approval' = 'pending-approval') => {
      if (!isOwner) {
          toast({ variant: "destructive", title: "Permission Denied", description: "Only the owner can change user status." });
          return;
      }
      if (uid === currentUserProfile?.uid) {
          toast({ variant: "destructive", title: "Invalid Action", description: "Owner cannot change their own status." });
          return;
      }

      let newStatus: 'active' | 'suspended';
      let disabled: boolean;

      if (currentStatus === 'suspended' || currentStatus === 'pending-approval') {
          newStatus = 'active';
          disabled = false;
      } else {
          newStatus = 'suspended';
          disabled = true;
      }

      toast({ title: "Updating Status...", description: `Please wait.` });

      try {
          if (!functions) throw new Error("Firebase Functions not available");
          const setUserStatusFn = httpsCallable(functions, 'setUserStatus');
          await setUserStatusFn({ uid, disabled, newStatus });
          toast({ title: "Success", description: `User status changed to ${newStatus}.` });
      } catch (error: any) {
          console.error("Error updating user status:", error);
          toast({ variant: "destructive", title: "Update Failed", description: error.message || "Could not update user status." });
      }
  };

  const handleDeleteUser = async (uid: string) => {
      if (!isOwner) {
          toast({ variant: "destructive", title: "Permission Denied" });
          return;
      }
       if (!functions) {
            toast({ variant: 'destructive', title: 'Error', description: 'Could not delete user because Functions are not available.' });
            return;
       }
      try {
        const deleteUserFn = httpsCallable(functions, 'deleteUser');
        await deleteUserFn({ uid });
        toast({ title: 'User Deleted', description: 'The user has been permanently deleted.' });
      } catch (error: any) {
        toast({ variant: 'destructive', title: 'Error', description: error.message || 'Failed to delete user.' });
      }
  };

  const handleSyncUserNames = async () => {
    if (!isOwner) {
        toast({ variant: 'destructive', title: 'Permission Denied' });
        return;
    }
    if (!functions) {
        toast({ variant: 'destructive', title: 'Functions not available' });
        return;
    }
    setIsSyncing(true);
    toast({ title: 'Syncing User Names...', description: 'This may take a moment. Please do not navigate away.' });
    try {
        const syncUserNamesToShiftsFn = httpsCallable(functions, 'syncUserNamesToShifts');
        const result = await syncUserNamesToShiftsFn();
        toast({ title: 'Sync Complete', description: (result.data as any).message });
    } catch (error: any) {
        toast({ variant: 'destructive', title: 'Sync Failed', description: error.message || 'An unknown error occurred.' });
    } finally {
        setIsSyncing(false);
    }
  };
  
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
                <CardTitle>User Management</CardTitle>
                <CardDescription>
                    View and manage all users.
                </CardDescription>
            </div>
            <div className="flex gap-2">
                {isOwner && (
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button variant="secondary" disabled={isSyncing}>
                                {isSyncing ? <Spinner /> : <RefreshCcw className="mr-2 h-4 w-4" />}
                                Sync Names
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Sync User Names to Shifts?</AlertDialogTitle>
                                <AlertDialogDescription>
                                This will update all existing shifts with the correct user name. Run this utility if you see "Unknown User" on schedules. This is a one-time operation to fix historical data.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={handleSyncUserNames}>Run Sync</AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                )}
                <Button variant="outline" onClick={handleDownloadPdf} disabled={loading || users.length === 0}>
                    <Download className="mr-2 h-4 w-4" />
                    Directory
                </Button>
            </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
            <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
            </div>
        ) : users.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
              <Users className="mx-auto h-12 w-12 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-semibold">No Users Found</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                No users have been created yet.
              </p>
            </div>
        ) : (
          <>
            <div className="hidden md:block border rounded-lg">
                <Table>
                <TableHeader>
                    <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Operative ID</TableHead>
                    <TableHead>Phone Number</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    {isPrivilegedUser && <TableHead>Type</TableHead>}
                    {isOwner && <TableHead className="text-right">Actions</TableHead>}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {users.map((user) => (
                        <TableRow key={user.uid} className={user.status === 'suspended' ? 'bg-muted/30' : ''}>
                          <TableCell className="font-medium">{user.name}</TableCell>
                          <TableCell>
                            {isPrivilegedUser ? (
                              <Input
                                defaultValue={user.operativeId || ''}
                                onBlur={(e) => handleOperativeIdChange(user.uid, e.target.value)}
                                className="h-8 w-24"
                                placeholder="Set ID"
                                disabled={!isPrivilegedUser}
                              />
                            ) : (
                              user.operativeId || <Badge variant="outline">N/A</Badge>
                            )}
                          </TableCell>
                          <TableCell>{user.phoneNumber || 'N/A'}</TableCell>
                          <TableCell>
                              <Badge variant={user.role === 'owner' ? 'default' : user.role === 'admin' ? 'secondary' : 'outline'} className="capitalize">
                                  {user.role}
                              </Badge>
                          </TableCell>
                          <TableCell>
                              {getStatusBadge(user.status)}
                          </TableCell>
                          {isPrivilegedUser && (
                              <TableCell>
                                  <Select
                                      value={user.employmentType || ''}
                                      onValueChange={(value) => handleEmploymentTypeChange(user.uid, value as 'direct' | 'subbie')}
                                      disabled={!isPrivilegedUser}
                                  >
                                      <SelectTrigger className="w-[120px]">
                                          <SelectValue placeholder="Set Type" />
                                      </SelectTrigger>
                                      <SelectContent>
                                          <SelectItem value="direct">Direct</SelectItem>
                                          <SelectItem value="subbie">Subbie</SelectItem>
                                      </SelectContent>
                                  </Select>
                              </TableCell>
                          )}
                          <TableCell className="text-right">
                              {isOwner && user.uid !== currentUserProfile?.uid && (
                                <div className="flex gap-2 justify-end">
                                  <Button variant="outline" size="sm" onClick={() => handleUserStatusChange(user.uid, user.status)}>
                                      {user.status === 'suspended' || user.status === 'pending-approval' ? 'Activate' : 'Suspend'}
                                  </Button>
                                  <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                      <Button variant="destructive" size="sm"><Trash2 className="h-4 w-4" /></Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                      <AlertDialogHeader>
                                        <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                                        <AlertDialogDescription>This will permanently delete the user "{user.name}". This action cannot be undone.</AlertDialogDescription>
                                      </AlertDialogHeader>
                                      <AlertDialogFooter>
                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                        <AlertDialogAction onClick={() => handleDeleteUser(user.uid)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
                                      </AlertDialogFooter>
                                    </AlertDialogContent>
                                  </AlertDialog>
                                </div>
                              )}
                          </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
                </Table>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:hidden">
              {users.map((user) => (
                <Card key={user.uid} className={user.status === 'suspended' ? 'bg-muted/50' : ''}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                        <CardTitle className="text-lg">{user.name}</CardTitle>
                        {getStatusBadge(user.status)}
                    </div>
                    <CardDescription>{user.phoneNumber || 'No phone number'}</CardDescription>
                  </CardHeader>
                  <CardContent className="text-sm space-y-3">
                     <p className="flex items-center gap-2"><strong>Role:</strong> <Badge variant={user.role === 'owner' ? 'default' : user.role === 'admin' ? 'secondary' : 'outline'} className="capitalize">{user.role}</Badge></p>
                     
                     {isPrivilegedUser && (
                        <>
                          <div className="flex items-center gap-2 pt-2">
                            <strong className="shrink-0">ID:</strong>
                            <Input
                                defaultValue={user.operativeId || ''}
                                onBlur={(e) => handleOperativeIdChange(user.uid, e.target.value)}
                                className="h-8"
                                placeholder="Set ID"
                                disabled={!isPrivilegedUser}
                              />
                          </div>
                          <div className="flex items-center gap-2 pt-2">
                            <strong className="shrink-0">Type:</strong>
                            <Select
                              value={user.employmentType || ''}
                              onValueChange={(value) => handleEmploymentTypeChange(user.uid, value as 'direct' | 'subbie')}
                              disabled={!isPrivilegedUser}
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="Set Type" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="direct">Direct</SelectItem>
                                <SelectItem value="subbie">Subbie</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </>
                     )}
                  </CardContent>
                  {isOwner && user.uid !== currentUserProfile?.uid && (
                    <CardFooter className="grid grid-cols-2 gap-2 p-2 bg-muted/20">
                      <Button variant="outline" size="sm" onClick={() => handleUserStatusChange(user.uid, user.status)} className="w-full">
                          {user.status === 'suspended' || user.status === 'pending-approval' ? 'Activate' : 'Suspend'}
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="destructive" size="sm" className="w-full"><Trash2 className="mr-2 h-4 w-4" /> Delete</Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader><AlertDialogTitle>Are you sure?</AlertDialogTitle><AlertDialogDescription>This will permanently delete "{user.name}".</AlertDialogDescription></AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleDeleteUser(user.uid)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </CardFooter>
                  )}
                </Card>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

    