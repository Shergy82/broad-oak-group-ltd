
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Download, Users, Trash2 } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { format } from 'date-fns';
import { Input } from '@/components/ui/input';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Spinner } from '@/components/shared/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Label } from '@/components/ui/label';


export default function UserManagementPage() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const { userProfile: currentUserProfile } = useUserProfile();
  const { toast } = useToast();
  
  const isOwner = currentUserProfile?.role === 'owner';
  const isPrivilegedUser = isOwner || currentUserProfile?.role === 'admin' || currentUserProfile?.role === 'manager' || currentUserProfile?.role === 'TLO';

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
        title: 'Error',
        description: "Could not fetch user list. Please check permissions.",
      });
      setUsers([]);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUserProfile, toast]);

  const adminAndManagerUsers = users.filter(user =>
    ['admin', 'owner', 'manager', 'TLO'].includes(user.role)
  );
  const engineerUsers = users.filter(user =>
    ['user'].includes(user.role)
  );
  
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

  const renderUserTabs = (userList: UserProfile[], categoryTitle: string) => {
    if (userList.length === 0) {
      return (
        <div className="border border-dashed rounded-lg p-8 text-center text-muted-foreground">
          <p>No users in the {categoryTitle.toLowerCase()} category.</p>
        </div>
      );
    }

    return (
      <Tabs defaultValue={userList[0].uid} className="w-full">
        <ScrollArea className="w-full whitespace-nowrap">
          <TabsList className="justify-start">
            {userList.map((user) => (
              <TabsTrigger key={user.uid} value={user.uid} className="gap-2">
                <Avatar className="h-6 w-6">
                  <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
                </Avatar>
                {user.name}
              </TabsTrigger>
            ))}
          </TabsList>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
        
        {userList.map((user) => (
          <TabsContent key={user.uid} value={user.uid} className="mt-4">
            <Card>
              <CardHeader>
                <div className="flex items-start gap-4">
                    <Avatar className="h-20 w-20 text-xl">
                      <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
                    </Avatar>
                    <div className="flex-grow">
                        <CardTitle className="text-2xl">{user.name}</CardTitle>
                        <CardDescription>{user.email}</CardDescription>
                        <CardDescription>{user.phoneNumber || 'No phone number'}</CardDescription>
                        <div className="mt-2">{getStatusBadge(user.status)}</div>
                    </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {/* Role */}
                    <div className="space-y-1.5">
                        <Label>Role</Label>
                        <div>
                            {isOwner && user.uid !== currentUserProfile?.uid ? (
                            <Select value={user.role} onValueChange={(value) => handleRoleChange(user.uid, value as UserProfile['role'])}>
                                <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="user">Engineer</SelectItem>
                                    <SelectItem value="TLO">TLO</SelectItem>
                                    <SelectItem value="manager">Manager</SelectItem>
                                    <SelectItem value="admin">Admin</SelectItem>
                                    <SelectItem value="owner">Owner</SelectItem>
                                </SelectContent>
                            </Select>
                            ) : (
                            <Badge variant={user.role === 'owner' ? 'default' : 'secondary'} className="capitalize text-sm p-2">{user.role}</Badge>
                            )}
                        </div>
                    </div>

                    {/* Operative ID */}
                     <div className="space-y-1.5">
                        <Label>Operative ID</Label>
                        {isPrivilegedUser ? (
                          <Input defaultValue={user.operativeId || ''} onBlur={(e) => handleOperativeIdChange(user.uid, e.target.value)} placeholder="Set ID" className="w-[180px]"/>
                        ) : ( <p className="text-sm text-muted-foreground pt-2">{user.operativeId || 'N/A'}</p> )}
                    </div>
                    
                    {/* Trade / Dept */}
                    <div className="space-y-1.5">
                        <Label>Trade / Department</Label>
                        <div className="flex gap-2">
                        {isPrivilegedUser ? (
                          <>
                            <Input defaultValue={user.trade || ''} onBlur={(e) => handleTradeChange(user.uid, e.target.value)} placeholder="Set Trade" className="w-[180px]"/>
                            <Input defaultValue={user.department || ''} onBlur={(e) => handleDepartmentChange(user.uid, e.target.value)} placeholder="Set Department" className="w-[180px]"/>
                          </>
                        ) : ( 
                            <div className="flex gap-2 pt-2">
                                <p className="text-sm text-muted-foreground">{user.trade || 'N/A'}</p>
                                <p className="text-sm text-muted-foreground">/ {user.department || 'N/A'}</p>
                            </div>
                        )}
                        </div>
                    </div>
                 </div>
              </CardContent>
              {isOwner && user.uid !== currentUserProfile?.uid && (
                <CardFooter className="bg-muted/50 p-4 border-t justify-end">
                  <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => handleUserStatusChange(user.uid, user.status)}>
                          {user.status === 'suspended' || user.status === 'pending-approval' ? 'Activate' : 'Suspend'}
                      </Button>
                      <AlertDialog>
                          <AlertDialogTrigger asChild><Button variant="destructive" size="sm"><Trash2 className="mr-2 h-4 w-4" /> Delete User</Button></AlertDialogTrigger>
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
          </TabsContent>
        ))}
      </Tabs>
    );
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
          <div className="space-y-8">
            <div>
                <h3 className="text-xl font-semibold mb-4">Management</h3>
                {renderUserTabs(adminAndManagerUsers, 'Management')}
            </div>

            <div>
                <h3 className="text-xl font-semibold mb-4">Engineers</h3>
                {renderUserTabs(engineerUsers, 'Engineers')}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

  