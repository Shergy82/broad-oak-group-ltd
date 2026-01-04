

'use client';

import { useEffect, useMemo, useState } from 'react';
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
import { Download, Users, Trash2, UserCog, Briefcase, User as UserIcon } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { format } from 'date-fns';
import { Input } from '@/components/ui/input';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';


export default function UserManagementPage() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const { userProfile: currentUserProfile } = useUserProfile();
  const { toast } = useToast();
  
  const isOwner = currentUserProfile?.role === 'owner';
  const isAdmin = currentUserProfile?.role === 'admin';
  const isPrivilegedUser = isOwner || isAdmin || currentUserProfile?.role === 'manager';
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

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
      let trades: { [key: string]: string } = {};

      if (typeof window !== 'undefined') {
        const storedTypes = localStorage.getItem('employmentTypes');
        if (storedTypes) {
          employmentTypes = JSON.parse(storedTypes);
        }
        const storedTrades = localStorage.getItem('userTrades');
        if (storedTrades) {
            trades = JSON.parse(storedTrades);
        }
      }

      const fetchedUsers: UserProfile[] = [];
      querySnapshot.forEach((doc) => {
        const user = { uid: doc.id, ...doc.data() } as UserProfile;
        // Apply locally stored type if it exists
        if (employmentTypes[user.uid]) {
            user.employmentType = employmentTypes[user.uid];
        }
        // Apply locally stored trade if it exists
        if (trades[user.uid]) {
            user.trade = trades[user.uid];
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
  
  const { adminsAndOwners, operatives } = useMemo(() => {
    const adminsAndOwners = users.filter(u => ['admin', 'owner', 'manager'].includes(u.role));
    const operatives = users.filter(u => u.role === 'user' || u.role === 'TLO');
    return { adminsAndOwners, operatives };
  }, [users]);

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

  const handleFieldChange = async (uid: string, field: 'operativeId' | 'trade' | 'role', value: string) => {
    const canChangeRole = (isOwner || isAdmin) && uid !== currentUserProfile?.uid;
    const canChangeOtherFields = isPrivilegedUser;

    if (field === 'role' && !canChangeRole) {
        toast({ variant: 'destructive', title: 'Permission Denied', description: 'You cannot change this user\'s role.' });
        return;
    }

    if (field !== 'role' && !canChangeOtherFields) {
        toast({ variant: "destructive", title: "Permission Denied", description: `You cannot change the ${field}.` });
        return;
    }

    if (!db) {
      toast({ variant: 'destructive', title: 'Database not configured' });
      return;
    }
    const userDocRef = doc(db, 'users', uid);
    try {
        await updateDoc(userDocRef, { [field]: value });
        if (field === 'trade' && typeof window !== 'undefined') {
            const storedTrades = localStorage.getItem('userTrades');
            const trades = storedTrades ? JSON.parse(storedTrades) : {};
            trades[uid] = value;
            localStorage.setItem('userTrades', JSON.stringify(trades));
        }
        toast({ title: "Success", description: `User's ${field} updated successfully.` });
    } catch (error: any) {
        toast({ variant: "destructive", title: "Update Failed", description: error.message || `Could not update ${field}.` });
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
    
    const isOperative = (u: UserProfile) => !['admin', 'owner', 'manager'].includes(u.role);

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
  
  const handleManageUser = (uid: string) => {
    if (projectId) {
      const url = `https://console.firebase.google.com/project/${projectId}/firestore/data/~2Fusers~2F${uid}`;
      window.open(url, '_blank');
    } else {
      toast({
        variant: 'destructive',
        title: 'Project ID not found',
        description: 'Could not construct the link to the Firebase Console.',
      });
    }
  };
  
  const renderUserTableRows = (userList: UserProfile[]) => {
      return userList.map((user) => {
        const canChangeRole = (isOwner || isAdmin) && user.uid !== currentUserProfile?.uid && user.role !== 'owner';
        const isUserOwner = user.role === 'owner';
        return (
            <TableRow key={user.uid} className={user.status === 'suspended' ? 'bg-muted/30' : ''}>
              <TableCell className="font-medium">{user.name}</TableCell>
              <TableCell>
                {isPrivilegedUser ? (
                  <Input
                    defaultValue={user.operativeId || ''}
                    onBlur={(e) => handleFieldChange(user.uid, 'operativeId', e.target.value)}
                    className="h-8 w-24"
                    placeholder="Set ID"
                    disabled={!isPrivilegedUser}
                  />
                ) : (
                  user.operativeId || <Badge variant="outline">N/A</Badge>
                )}
              </TableCell>
              <TableCell>
                 <Input
                    defaultValue={user.trade || ''}
                    onBlur={(e) => handleFieldChange(user.uid, 'trade', e.target.value)}
                    className="h-8 w-32"
                    placeholder="N/A"
                    disabled={!isPrivilegedUser}
                  />
              </TableCell>
              <TableCell>{user.phoneNumber || 'N/A'}</TableCell>
              <TableCell>
                {canChangeRole ? (
                  <Select
                    value={user.role}
                    onValueChange={(value) => handleFieldChange(user.uid, 'role', value)}
                  >
                    <SelectTrigger className="w-[120px]">
                      <SelectValue placeholder="Set Role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">User</SelectItem>
                      <SelectItem value="TLO">TLO</SelectItem>
                      <SelectItem value="manager">Manager</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <Badge variant={isUserOwner ? 'default' : user.role === 'admin' ? 'secondary' : 'outline'} className={`capitalize ${user.role === 'manager' ? 'bg-orange-500 hover:bg-orange-600 text-white' : ''} ${user.role === 'TLO' ? 'bg-purple-500 hover:bg-purple-600 text-white' : ''}`}>
                    {user.role}
                  </Badge>
                )}
              </TableCell>
              <TableCell>
                  {getStatusBadge(user.status)}
              </TableCell>
              {isPrivilegedUser && (
                  <TableCell>
                      {['admin', 'owner', 'manager'].includes(user.role) ? (
                          <Badge variant="outline">N/A</Badge>
                      ) : (
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
                      )}
                  </TableCell>
              )}
              <TableCell className="text-right">
                  {isOwner && user.uid !== currentUserProfile?.uid && (
                    <div className="flex gap-2 justify-end">
                       <Button variant="outline" size="sm" onClick={() => handleManageUser(user.uid)}>
                        <UserCog className="mr-2 h-4 w-4" /> Manage
                      </Button>
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
        )});
  }
  
  const renderUserCards = (userList: UserProfile[]) => {
      return userList.map((user) => {
        const canChangeRole = (isOwner || isAdmin) && user.uid !== currentUserProfile?.uid && user.role !== 'owner';
        const isUserOwner = user.role === 'owner';
        return (
            <Card key={user.uid} className={user.status === 'suspended' ? 'bg-muted/50' : ''}>
              <CardHeader>
                <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">{user.name}</CardTitle>
                    {getStatusBadge(user.status)}
                </div>
                <CardDescription>{user.phoneNumber || 'No phone number'}</CardDescription>
              </CardHeader>
              <CardContent className="text-sm space-y-3">
                 <div className="flex items-center gap-2">
                    <strong>Role:</strong>
                    {canChangeRole ? (
                      <Select
                        value={user.role}
                        onValueChange={(value) => handleFieldChange(user.uid, 'role', value)}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Set Role" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="user">User</SelectItem>
                          <SelectItem value="TLO">TLO</SelectItem>
                          <SelectItem value="manager">Manager</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant={isUserOwner ? 'default' : user.role === 'admin' ? 'secondary' : 'outline'} className={`capitalize ${user.role === 'manager' ? 'bg-orange-500 hover:bg-orange-600 text-white' : ''} ${user.role === 'TLO' ? 'bg-purple-500 hover:bg-purple-600 text-white' : ''}`}>
                          {user.role}
                      </Badge>
                    )}
                  </div>
                 
                 {isPrivilegedUser && (
                    <>
                      <div className="flex items-center gap-2 pt-2">
                        <strong className="shrink-0">ID:</strong>
                        <Input
                            defaultValue={user.operativeId || ''}
                            onBlur={(e) => handleFieldChange(user.uid, 'operativeId', e.target.value)}
                            className="h-8"
                            placeholder="Set ID"
                            disabled={!isPrivilegedUser}
                          />
                      </div>
                      <div className="flex items-center gap-2 pt-2">
                        <strong className="shrink-0">Trade/Role:</strong>
                        <Input
                            defaultValue={user.trade || ''}
                            onBlur={(e) => handleFieldChange(user.uid, 'trade', e.target.value)}
                            className="h-8"
                            placeholder="N/A"
                            disabled={!isPrivilegedUser}
                        />
                      </div>
                      {!['admin', 'owner', 'manager'].includes(user.role) && (
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
                      )}
                    </>
                 )}
              </CardContent>
              {isOwner && user.uid !== currentUserProfile?.uid && (
                <CardFooter className="grid grid-cols-2 gap-2 p-2 bg-muted/20">
                  <Button variant="outline" size="sm" onClick={() => handleManageUser(user.uid)} className="w-full">
                    <UserCog className="mr-2 h-4 w-4" /> Manage
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => handleUserStatusChange(user.uid, user.status)} className="w-full">
                      {user.status === 'suspended' || user.status === 'pending-approval' ? 'Activate' : 'Suspend'}
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive" size="sm" className="w-full col-span-2"><Trash2 className="mr-2 h-4 w-4" /> Delete</Button>
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
          )});
  }


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
                    <TableHead>Trade/Role</TableHead>
                    <TableHead>Phone Number</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    {isPrivilegedUser && <TableHead>Type</TableHead>}
                    {isOwner && <TableHead className="text-right">Actions</TableHead>}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {adminsAndOwners.length > 0 && renderUserTableRows(adminsAndOwners)}

                    {operatives.length > 0 && (
                        <>
                            <TableRow>
                                <TableCell colSpan={isOwner ? 8 : 7} className="bg-muted/60">
                                    <h3 className="font-semibold text-muted-foreground flex items-center gap-2">
                                        <Briefcase className="h-5 w-5" />
                                        Operatives
                                    </h3>
                                </TableCell>
                            </TableRow>
                            {renderUserTableRows(operatives)}
                        </>
                    )}
                </TableBody>
                </Table>
            </div>

            <div className="space-y-6 md:hidden">
              {adminsAndOwners.length > 0 && (
                <div>
                    <h3 className="text-lg font-semibold mb-4 flex items-center gap-2 text-muted-foreground">
                        <UserCog className="h-5 w-5" />
                        Admins, Owners & Managers
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {renderUserCards(adminsAndOwners)}
                    </div>
                </div>
              )}

              {operatives.length > 0 && (
                 <div>
                    <h3 className="text-lg font-semibold mb-4 flex items-center gap-2 text-muted-foreground">
                        <UserIcon className="h-5 w-5" />
                        Operatives
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {renderUserCards(operatives)}
                    </div>
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
