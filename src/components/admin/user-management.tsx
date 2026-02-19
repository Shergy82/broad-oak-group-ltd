'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, doc, updateDoc, where } from 'firebase/firestore';
import { db, functions } from '@/lib/firebase';
import { httpsCallable } from 'firebase/functions';
import type { UserProfile } from '@/types';
import { useUserProfile } from '@/hooks/use-user-profile';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Download, Users, Trash2, Search } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Spinner } from '@/components/shared/spinner';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDepartmentFilter } from '@/hooks/use-department-filter';

export function UserManagement() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const { userProfile: currentUserProfile } = useUserProfile();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('all');

  const { selectedDepartments, availableDepartments } = useDepartmentFilter();
  
  const isOwner = currentUserProfile?.role === 'owner';
  const isPrivilegedUser = isOwner || currentUserProfile?.role === 'admin' || currentUserProfile?.role === 'manager' || currentUserProfile?.role === 'TLO';

  useEffect(() => {
    if (!currentUserProfile || !db) {
      setUsers([]);
      setLoading(false);
      return;
    }

    let usersQuery;
    if (isOwner) {
        usersQuery = query(collection(db, 'users'));
    } else if (currentUserProfile.department) {
        usersQuery = query(collection(db, 'users'), where('department', '==', currentUserProfile.department));
    } else {
        // Show only self if no department and not owner
        usersQuery = query(collection(db, 'users'), where('uid', '==', currentUserProfile.uid));
    }

    const unsubscribe = onSnapshot(usersQuery, (querySnapshot) => {
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
        title: 'Error',
        description: "Could not fetch user list. Please check permissions.",
      });
      setUsers([]);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUserProfile, toast, isOwner]);

  const pendingUsers = useMemo(() => users.filter(user => user.status === 'pending-approval'), [users]);

  const usersToDisplay = useMemo(() => {
    const sourceUsers = activeTab === 'pending' ? pendingUsers : users;
    let filtered = sourceUsers;

    if (isOwner && availableDepartments.length > 0) {
      filtered = filtered.filter(user => user.department && selectedDepartments.has(user.department));
    }
    
    if (!searchTerm) {
      return filtered;
    }

    return filtered.filter(user =>
      user.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [users, pendingUsers, activeTab, searchTerm, isOwner, selectedDepartments, availableDepartments]);


  const adminAndManagerUsers = useMemo(() => usersToDisplay.filter(user =>
    ['admin', 'owner', 'manager', 'TLO'].includes(user.role)
  ), [usersToDisplay]);

  const engineerUsers = useMemo(() => usersToDisplay.filter(user =>
    user.role === 'user'
  ), [usersToDisplay]);
  
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

  const handleTradeChange = async (uid: string, trade: string) => {
    if (!isPrivilegedUser) {
        toast({ variant: "destructive", title: "Permission Denied", description: "You cannot change the trade." });
        return;
    }
    if (!db) {
      toast({ variant: 'destructive', title: 'Database not configured' });
      return;
    }
    const userDocRef = doc(db, 'users', uid);
    try {
        await updateDoc(userDocRef, { trade });
        toast({ title: "Success", description: "User trade updated." });
    } catch (error: any) {
        toast({ variant: "destructive", title: "Update Failed", description: error.message || "Could not update trade." });
    }
  };

  const handleDepartmentChange = async (uid: string, department: string) => {
    if (!isPrivilegedUser) {
        toast({ variant: "destructive", title: "Permission Denied", description: "You cannot change the department." });
        return;
    }
    if (!db) {
      toast({ variant: 'destructive', title: 'Database not configured' });
      return;
    }
    const userDocRef = doc(db, 'users', uid);
    try {
        await updateDoc(userDocRef, { department });
        toast({ title: "Success", description: "User department updated." });
    } catch (error: any) {
        toast({ variant: "destructive", title: "Update Failed", description: error.message || "Could not update department." });
    }
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
    doc.text(`Generated on: ${new Date(generationDate).toLocaleDateString()}`, 14, 28);
    
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
    
    doc.save(`user_directory_${new Date(generationDate).toISOString().slice(0,10)}.pdf`);
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

  const handleRoleChange = async (uid: string, role: UserProfile['role']) => {
    if (!isOwner) {
        toast({ variant: "destructive", title: "Permission Denied", description: "Only the owner can change user roles." });
        return;
    }
    if (uid === currentUserProfile?.uid) {
        toast({ variant: "destructive", title: "Invalid Action", description: "You cannot change your own role." });
        return;
    }
    if (!db) {
      toast({ variant: 'destructive', title: 'Database not configured' });
      return;
    }
    const userDocRef = doc(db, 'users', uid);
    try {
        await updateDoc(userDocRef, { role });
        toast({ title: "Success", description: "User role updated." });
    } catch (error: any) {
        toast({ variant: "destructive", title: "Update Failed", description: error.message || "Could not update user role." });
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

  const getInitials = (name?: string) => {
    if (!name) return '??';
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase();
  };

  const renderUserGrid = (userList: UserProfile[], categoryTitle: string) => {
    if (userList.length === 0) {
      if (activeTab === 'pending') {
         return (
          <div className="border border-dashed rounded-lg p-8 text-center text-muted-foreground">
            <p>No pending applications in this category.</p>
          </div>
        );
      }
      return null;
    }

    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
        {userList.map((user) => (
          <Card key={user.uid} className="flex flex-col text-center">
            <CardHeader className="relative">
                <div className="absolute top-3 right-3">{getStatusBadge(user.status)}</div>
                <Avatar className="h-24 w-24 text-3xl mx-auto mb-4">
                    <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
                </Avatar>
                <h3 className="text-xl font-semibold">{user.name}</h3>
                {user.phoneNumber ? (
                  <a href={`tel:${user.phoneNumber}`} className="text-sm text-muted-foreground hover:underline">
                    {user.phoneNumber}
                  </a>
                ) : (
                  <p className="text-sm text-muted-foreground italic">No phone number</p>
                )}
                <p className="text-muted-foreground capitalize text-sm pt-1">{user.trade || user.role}</p>
            </CardHeader>
            <CardContent className="p-6 flex-grow flex flex-col items-center space-y-4">
                <div className="space-y-1.5 text-left w-full flex-grow">
                    <Label className="text-xs">Role</Label>
                    {isOwner && user.uid !== currentUserProfile?.uid ? (
                    <Select value={user.role} onValueChange={(value) => handleRoleChange(user.uid, value as UserProfile['role'])}>
                        <SelectTrigger className="w-full h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="user">Engineer</SelectItem>
                            <SelectItem value="TLO">TLO</SelectItem>
                            <SelectItem value="manager">Manager</SelectItem>
                            <SelectItem value="admin">Admin</SelectItem>
                            <SelectItem value="owner">Owner</SelectItem>
                        </SelectContent>
                    </Select>
                    ) : (
                    <p className="text-sm capitalize font-medium p-2 border rounded-md bg-muted/50 h-8 flex items-center">{user.role}</p>
                    )}
                </div>
                <div className="space-y-1.5 text-left w-full flex-grow">
                    <Label className="text-xs">Operative ID</Label>
                    {isPrivilegedUser ? (
                        <Input defaultValue={user.operativeId || ''} onBlur={(e) => handleOperativeIdChange(user.uid, e.target.value)} placeholder="Set ID" className="h-8 text-xs"/>
                    ) : ( <p className="text-sm p-2 border rounded-md bg-muted/50 h-8 flex items-center">{user.operativeId || 'N/A'}</p> )}
                </div>
                <div className="space-y-1.5 text-left w-full flex-grow">
                    <Label className="text-xs">Trade / Department</Label>
                    {isPrivilegedUser ? (
                        <div className="flex gap-2">
                            <Input defaultValue={user.trade || ''} onBlur={(e) => handleTradeChange(user.uid, e.target.value)} onKeyPress={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} placeholder="Trade" className="h-8 text-xs"/>
                            <Input
                                defaultValue={user.department || ''}
                                onBlur={(e) => handleDepartmentChange(user.uid, e.target.value)}
                                onKeyPress={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                placeholder="Dept"
                                className="h-8 text-xs"
                            />
                        </div>
                    ) : ( <p className="text-sm p-2 border rounded-md bg-muted/50 h-8 flex items-center">{user.trade || 'N/A'} / {user.department || 'N/A'}</p> )}
                </div>
            </CardContent>
            {isOwner && user.uid !== currentUserProfile?.uid && (
            <CardFooter className="p-4 border-t w-full mt-auto">
                <div className="grid grid-cols-2 gap-2 w-full">
                    <Button variant="outline" size="sm" onClick={() => handleUserStatusChange(user.uid, user.status)} className="w-full">
                        {user.status === 'suspended' || user.status === 'pending-approval' ? 'Activate' : 'Suspend'}
                    </Button>
                    <AlertDialog>
                        <AlertDialogTrigger asChild><Button variant="destructive" size="sm" className="w-full"><Trash2 className="mr-2 h-4 w-4" /> Delete</Button></AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader><AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle><AlertDialogDescription>This will permanently delete the user "{user.name}" and all their associated data. This action cannot be undone.</AlertDialogDescription></AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => handleDeleteUser(user.uid)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                </div>
            </CardFooter>
            )}
          </Card>
        ))}
      </div>
    );
  };
  
  return (
    <div className="space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex flex-col sm:flex-row items-center gap-4 w-full">
                <div className="relative w-full sm:w-auto">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search users..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full sm:w-64 pl-10"
                    />
                </div>
            </div>
            <Button variant="outline" onClick={handleDownloadPdf} disabled={loading || users.length === 0} className="w-full sm:w-auto">
                <Download className="mr-2 h-4 w-4" />
                Directory
            </Button>
        </div>
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
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="all">All Users</TabsTrigger>
            <TabsTrigger value="pending">
              Pending Applications
              {pendingUsers.length > 0 && (
                <Badge className="ml-2 bg-amber-500 text-white hover:bg-amber-500">{pendingUsers.length}</Badge>
              )}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="all" className="mt-6">
            <div className="space-y-8">
              <div>
                  <h3 className="text-xl font-semibold mb-4">Management</h3>
                  {renderUserGrid(adminAndManagerUsers, 'Management')}
              </div>
              <div>
                  <h3 className="text-xl font-semibold mb-4">Engineers</h3>
                  {renderUserGrid(engineerUsers, 'Engineers')}
              </div>
            </div>
          </TabsContent>
          <TabsContent value="pending" className="mt-6">
             <div className="space-y-8">
                {usersToDisplay.length > 0 ? (
                  <>
                    <div>
                        <h3 className="text-xl font-semibold mb-4">Management</h3>
                        {renderUserGrid(adminAndManagerUsers, 'Management')}
                    </div>
                    <div>
                        <h3 className="text-xl font-semibold mb-4">Engineers</h3>
                        {renderUserGrid(engineerUsers, 'Engineers')}
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
                    <Users className="mx-auto h-12 w-12 text-muted-foreground" />
                    <h3 className="mt-4 text-lg font-semibold">No Pending Applications</h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      There are no new user registrations to approve.
                    </p>
                  </div>
                )}
             </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
