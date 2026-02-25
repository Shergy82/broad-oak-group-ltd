

'use client';

import { useState, useEffect, useMemo } from 'react';
import { db, functions, httpsCallable } from '@/lib/firebase';
import { collection, onSnapshot, query, doc, updateDoc } from 'firebase/firestore';
import type { UserProfile } from '@/types';
import { useUserProfile } from '@/hooks/use-user-profile';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/shared/spinner';
import { Skeleton } from '@/components/ui/skeleton';
import { Search, Check, Ban, Trash, Edit, AlertTriangle } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { useDepartmentFilter } from '@/hooks/use-department-filter';

function EditUserDialog({ user, open, onOpenChange, context, availableDepartments }: { user: UserProfile, open: boolean, onOpenChange: (open: boolean) => void, context: 'unassigned' | 'default', availableDepartments: string[] }) {
    const { toast } = useToast();
    const [isLoading, setIsLoading] = useState(false);
    const [role, setRole] = useState(user.role);
    const [department, setDepartment] = useState(user.department || '');
    const [trade, setTrade] = useState(user.trade || '');
    const [operativeId, setOperativeId] = useState(user.operativeId || '');

    useEffect(() => {
        if (open) {
            setRole(user.role);
            setDepartment(user.department || '');
            setTrade(user.trade || '');
            setOperativeId(user.operativeId || '');
        }
    }, [user, open]);

    const handleSaveChanges = async () => {
        setIsLoading(true);
        try {
            if (context === 'unassigned' && !department) {
                toast({ variant: 'destructive', title: "Department Required", description: "Please select a department to assign this user." });
                setIsLoading(false);
                return;
            }

            const userRef = doc(db, 'users', user.uid);
            await updateDoc(userRef, {
                role,
                department,
                trade,
                operativeId,
                // If they were pending and are now being assigned, set them to active.
                ...(user.status === 'pending-approval' && department && { status: 'active' }),
            });
            toast({ title: "User Updated", description: `${user.name}'s details have been updated.` });
            onOpenChange(false);
        } catch (error: any) {
            console.error("Error updating user:", error);
            toast({ variant: 'destructive', title: "Update Failed", description: error.message || "Could not update user details." });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{context === 'unassigned' ? `Assign Department for ${user.name}` : `Edit User: ${user.name}`}</DialogTitle>
                    <DialogDescription>
                        {context === 'unassigned' ? "Select a department to move this user to the active list." : "Modify the user's role and other details."}
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                     <div className="space-y-2">
                        <Label htmlFor="department-select">Department</Label>
                         <Select onValueChange={(value) => setDepartment(value)} value={department}>
                            <SelectTrigger id="department-select">
                                <SelectValue placeholder="Select a department..." />
                            </SelectTrigger>
                            <SelectContent>
                                {availableDepartments.map(dept => (
                                    <SelectItem key={dept} value={dept}>{dept}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    {context !== 'unassigned' && (
                        <>
                            <div className="space-y-2">
                                <Label htmlFor="role-select">Role</Label>
                                <Select value={role} onValueChange={(value) => setRole(value as UserProfile['role'])}>
                                    <SelectTrigger id="role-select"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="user">User</SelectItem>
                                        <SelectItem value="TLO">TLO</SelectItem>
                                        <SelectItem value="manager">Manager</SelectItem>
                                        <SelectItem value="admin">Admin</SelectItem>
                                        <SelectItem value="owner">Owner</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="trade-input">Trade</Label>
                                <Input id="trade-input" value={trade} onChange={(e) => setTrade(e.target.value)} placeholder="e.g., Plumber" />
                            </div>
                             <div className="space-y-2">
                                <Label htmlFor="opid-input">Operative ID</Label>
                                <Input id="opid-input" value={operativeId} onChange={(e) => setOperativeId(e.target.value)} placeholder="e.g., BOG-001" />
                            </div>
                        </>
                    )}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>Cancel</Button>
                    <Button onClick={handleSaveChanges} disabled={isLoading}>
                        {isLoading ? <Spinner /> : context === 'unassigned' ? "Assign & Activate" : "Save Changes"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export default function UserManagementPage() {
    const { userProfile: currentUserProfile, loading: currentUserLoading } = useUserProfile();
    const [users, setUsers] = useState<UserProfile[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
    const [isEditUserOpen, setIsEditUserOpen] = useState(false);
    const [editContext, setEditContext] = useState<'unassigned' | 'default'>('default');
    const { toast } = useToast();
    const { selectedDepartments } = useDepartmentFilter();

    useEffect(() => {
        const q = query(collection(db, 'users'));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            setUsers(snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile)));
            setLoading(false);
        }, (error) => {
            console.error("Error fetching users:", error);
            setLoading(false);
        });
        return () => unsubscribe();
    }, []);
    
    const availableDepartments = useMemo(() => {
        const depts = new Set<string>();
        users.forEach(u => {
            if (u.department) depts.add(u.department);
        });
        return Array.from(depts).sort();
    }, [users]);

    const { pendingUsers, unassignedUsers, activeUsers, suspendedUsers } = useMemo(() => {
        const isOwner = currentUserProfile?.role === 'owner';
        const isAdmin = currentUserProfile?.role === 'admin';

        const searchedUsers = users.filter(u => 
            (u.name?.toLowerCase().includes(searchTerm.toLowerCase())) ||
            (u.email?.toLowerCase().includes(searchTerm.toLowerCase()))
        );
        
        const pending = searchedUsers.filter(u => u.status === 'pending-approval');
        const unassigned = searchedUsers.filter(u => u.status !== 'pending-approval' && !u.department);
        const assignedWithDept = searchedUsers.filter(u => u.status !== 'pending-approval' && !!u.department);
        
        let visibleAssigned = assignedWithDept;
        if (isOwner) {
            if (selectedDepartments.size > 0) {
                 visibleAssigned = assignedWithDept.filter(u => u.department && selectedDepartments.has(u.department));
            }
        } else if (isAdmin) {
             visibleAssigned = assignedWithDept.filter(u => u.department === currentUserProfile?.department);
        } else {
            visibleAssigned = [];
        }

        return {
            pendingUsers: pending,
            unassignedUsers: unassigned,
            activeUsers: visibleAssigned.filter(u => u.status === 'active' || !u.status),
            suspendedUsers: visibleAssigned.filter(u => u.status === 'suspended'),
        };
    }, [users, searchTerm, currentUserProfile, selectedDepartments]);
    
    const handleSetUserStatus = async (user: UserProfile, newStatus: 'active' | 'suspended') => {
        if (!functions) {
            toast({ variant: 'destructive', title: "Functions not available."});
            return;
        }

        const payload: { uid: string, disabled: boolean, newStatus: string, department?: string } = { 
            uid: user.uid, 
            disabled: newStatus === 'suspended', 
            newStatus 
        };

        if (newStatus === 'active' && !user.department) {
            const adminDepartment = currentUserProfile?.department || currentUserProfile?.baseDepartment;
            if (adminDepartment) {
                payload.department = adminDepartment;
            }
        }
        
        try {
            const setUserStatusFn = httpsCallable<typeof payload, {success: boolean}>(functions, 'setUserStatus');
            await setUserStatusFn(payload);
            toast({ title: "User status updated." });
        } catch (error: any) {
            toast({ variant: 'destructive', title: "Error", description: error.message });
        }
    };
    
    const handleDeleteUser = async (user: UserProfile) => {
        if (!functions) {
            toast({ variant: 'destructive', title: "Functions not available."});
            return;
        }
        try {
            const deleteUserFn = httpsCallable<{uid: string}, {success: boolean}>(functions, 'deleteUser');
            await deleteUserFn({ uid: user.uid });
            toast({ title: "User Deleted", description: "The user and their authentication account have been permanently removed." });
        } catch (error: any) {
            toast({ variant: 'destructive', title: "Error", description: error.message });
        }
    };

    const handleEditUser = (user: UserProfile, context: 'unassigned' | 'default' = 'default') => {
        setSelectedUser(user);
        setEditContext(context);
        setIsEditUserOpen(true);
    };

    const renderUserList = (usersToRender: UserProfile[], type: 'pending' | 'active' | 'suspended' | 'unassigned') => {
        if (usersToRender.length === 0) {
            return <p className="text-center text-sm text-muted-foreground p-4">No users in this category.</p>
        }

        if (type === 'unassigned') {
            return (
                <>
                    {/* Desktop Table View */}
                    <div className="border rounded-lg hidden md:block">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Name</TableHead>
                                    <TableHead className="text-right">Action</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {usersToRender.map(user => (
                                    <TableRow key={user.uid}>
                                        <TableCell className="font-medium">{user.name}</TableCell>
                                        <TableCell className="text-right">
                                            <Button size="sm" onClick={() => handleEditUser(user, 'unassigned')}>
                                                <Edit className="mr-2 h-4 w-4" />
                                                Assign Department
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                    
                    {/* Mobile Card View */}
                    <div className="grid gap-4 md:hidden">
                      {usersToRender.map(user => (
                          <Card key={user.uid}>
                              <CardHeader>
                                  <CardTitle>{user.name}</CardTitle>
                              </CardHeader>
                              <CardFooter>
                                <Button className="w-full" onClick={() => handleEditUser(user, 'unassigned')}>
                                    <Edit className="mr-2 h-4 w-4" />
                                    Assign Department
                                </Button>
                              </CardFooter>
                          </Card>
                      ))}
                    </div>
                </>
            );
        }
        
        return (
          <>
            {/* Desktop Table View */}
            <div className="border rounded-lg hidden md:block">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Department</TableHead>
                            <TableHead>Trade</TableHead>
                            <TableHead>Role</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {usersToRender.map(user => {
                            const status = user.status || 'active';
                            return (
                                <TableRow key={user.uid}>
                                    <TableCell className="font-medium">
                                        {user.name}
                                        {user.operativeId && <div className="text-xs text-muted-foreground">{user.operativeId}</div>}
                                    </TableCell>
                                    <TableCell>{user.department || 'N/A'}</TableCell>
                                    <TableCell>{user.trade || 'N/A'}</TableCell>
                                    <TableCell><Badge variant="outline" className="capitalize">{user.role}</Badge></TableCell>
                                    <TableCell>
                                        <Badge
                                            variant={
                                                status === 'suspended' ? 'destructive' :
                                                status === 'pending-approval' ? 'secondary' :
                                                'default'
                                            }
                                            className={cn(
                                                "capitalize",
                                                status === 'active' && 'bg-green-600 hover:bg-green-700 text-primary-foreground'
                                            )}
                                        >
                                            {status.replace('-', ' ')}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-right space-x-1">
                                        {type === 'pending' && <Button size="sm" onClick={() => handleSetUserStatus(user, 'active')}><Check className="mr-2 h-4 w-4" />Activate</Button>}
                                        {type === 'active' && <Button size="sm" variant="destructive" onClick={() => handleSetUserStatus(user, 'suspended')}><Ban className="mr-2 h-4 w-4" />Suspend</Button>}
                                        {type === 'suspended' && <Button size="sm" onClick={() => handleSetUserStatus(user, 'active')}><Check className="mr-2 h-4 w-4" />Re-activate</Button>}
                                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEditUser(user)}><Edit className="h-4 w-4" /></Button>
                                        <AlertDialog>
                                            <AlertDialogTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8 text-destructive/70"><Trash className="h-4 w-4" /></Button></AlertDialogTrigger>
                                            <AlertDialogContent>
                                                <AlertDialogHeader><AlertDialogTitle>Delete User?</AlertDialogTitle><AlertDialogDescription>This will permanently delete {user.name} and their authentication account. This action cannot be undone.</AlertDialogDescription></AlertDialogHeader>
                                                <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => handleDeleteUser(user)} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">Delete User</AlertDialogAction></AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                    </TableCell>
                                </TableRow>
                            )
                        })}
                    </TableBody>
                </Table>
            </div>
            
            {/* Mobile Card View */}
            <div className="grid gap-4 md:hidden">
              {usersToRender.map(user => {
                  const status = user.status || 'active';
                  return (
                      <Card key={user.uid}>
                          <CardHeader>
                              <CardTitle>{user.name}</CardTitle>
                              {user.operativeId && <CardDescription>ID: {user.operativeId}</CardDescription>}
                          </CardHeader>
                          <CardContent className="text-sm space-y-3">
                              <div><strong>Department:</strong> {user.department || 'N/A'}</div>
                              <div><strong>Trade:</strong> {user.trade || 'N/A'}</div>
                              <div className="flex items-center gap-2"><strong>Role:</strong> <Badge variant="outline" className="capitalize">{user.role}</Badge></div>
                              <div className="flex items-center gap-2"><strong>Status:</strong>
                                  <Badge
                                      variant={status === 'suspended' ? 'destructive' : status === 'pending-approval' ? 'secondary' : 'default'}
                                      className={cn("capitalize", status === 'active' && 'bg-green-600 hover:bg-green-700 text-primary-foreground')}
                                  >
                                      {status.replace('-', ' ')}
                                  </Badge>
                              </div>
                          </CardContent>
                          <CardFooter className="flex flex-col gap-2">
                                {type === 'pending' && <Button size="sm" onClick={() => handleSetUserStatus(user, 'active')} className="w-full"><Check className="mr-2 h-4 w-4" />Activate</Button>}
                                {type === 'active' && <Button size="sm" variant="destructive" onClick={() => handleSetUserStatus(user, 'suspended')} className="w-full"><Ban className="mr-2 h-4 w-4" />Suspend</Button>}
                                {type === 'suspended' && <Button size="sm" onClick={() => handleSetUserStatus(user, 'active')} className="w-full"><Check className="mr-2 h-4 w-4" />Re-activate</Button>}
                                
                                <div className="grid grid-cols-2 gap-2 w-full">
                                    <Button variant="outline" className="w-full" onClick={() => handleEditUser(user)}><Edit className="mr-2 h-4 w-4" />Edit</Button>
                                    <AlertDialog>
                                        <AlertDialogTrigger asChild><Button variant="destructive" className="w-full"><Trash className="mr-2 h-4 w-4" />Delete</Button></AlertDialogTrigger>
                                        <AlertDialogContent>
                                            <AlertDialogHeader><AlertDialogTitle>Delete User?</AlertDialogTitle><AlertDialogDescription>This will permanently delete {user.name} and their authentication account. This action cannot be undone.</AlertDialogDescription></AlertDialogHeader>
                                            <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => handleDeleteUser(user)} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">Delete User</AlertDialogAction></AlertDialogFooter>
                                        </AlertDialogContent>
                                    </AlertDialog>
                                </div>
                          </CardFooter>
                      </Card>
                  )
              })}
            </div>
          </>
        );
    }
    
    if (loading || currentUserLoading) {
        return (
             <Card>
                <CardHeader>
                    <CardTitle>User Management</CardTitle>
                    <CardDescription>Approve new users, manage roles, and suspend or delete accounts.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Skeleton className="h-96 w-full" />
                </CardContent>
             </Card>
        );
    }
    
    if (!['owner', 'admin'].includes(currentUserProfile?.role || '')) {
        return (
            <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Access Denied</AlertTitle>
                <AlertDescription>
                You do not have permission to view this page. User management is restricted to owners and admins.
                </AlertDescription>
            </Alert>
        );
    }

    return (
        <>
            <Card>
                <CardHeader>
                    <CardTitle>User Management</CardTitle>
                    <CardDescription>Approve new users, manage roles, and suspend or delete accounts.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search by name or email..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full max-w-sm pl-10"
                        />
                    </div>
                    <Tabs defaultValue="pending">
                        <TabsList className="grid h-auto w-full grid-cols-1 sm:h-10 sm:grid-cols-4">
                            <TabsTrigger value="pending">Pending ({pendingUsers.length})</TabsTrigger>
                            <TabsTrigger value="unassigned">Unassigned ({unassignedUsers.length})</TabsTrigger>
                            <TabsTrigger value="active">Active ({activeUsers.length})</TabsTrigger>
                            <TabsTrigger value="suspended">Suspended ({suspendedUsers.length})</TabsTrigger>
                        </TabsList>
                        <TabsContent value="pending" className="mt-4">{renderUserList(pendingUsers, 'pending')}</TabsContent>
                        <TabsContent value="unassigned" className="mt-4">{renderUserList(unassignedUsers, 'unassigned')}</TabsContent>
                        <TabsContent value="active" className="mt-4">{renderUserList(activeUsers, 'active')}</TabsContent>
                        <TabsContent value="suspended" className="mt-4">{renderUserList(suspendedUsers, 'suspended')}</TabsContent>
                    </Tabs>
                </CardContent>
            </Card>
            {selectedUser && <EditUserDialog user={selectedUser} open={isEditUserOpen} onOpenChange={setIsEditUserOpen} context={editContext} availableDepartments={availableDepartments} />}
        </>
    )
}
