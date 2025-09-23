
'use client';

import { useEffect, useState } from 'react';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
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
import { Download, ExternalLink, Users } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { format } from 'date-fns';
import { Input } from '@/components/ui/input';

const getLocalStorageItem = <T>(key: string, defaultValue: T): T => {
    if (typeof window === 'undefined') return defaultValue;
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : defaultValue;
};

const setLocalStorageItem = <T>(key: string, value: T) => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(key, JSON.stringify(value));
};

export default function UserManagementPage() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const { userProfile: currentUserProfile } = useUserProfile();
  const { toast } = useToast();
  const [localUserData, setLocalUserData] = useState<{ [key: string]: { employmentType?: 'direct' | 'subbie', operativeId?: string } }>({});

  const isOwner = currentUserProfile?.role === 'owner';
  const isPrivilegedUser = isOwner || currentUserProfile?.role === 'admin';

  useEffect(() => {
    setLocalUserData(getLocalStorageItem('user_management_data', {}));
  }, []);

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

  const generateConsoleLink = (uid: string) => {
    const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    if (!projectId) return '#';
    return `https://console.firebase.google.com/project/${projectId}/auth/users`;
  }

  const handleLocalDataChange = (uid: string, key: 'employmentType' | 'operativeId', value: string) => {
    const updatedData = {
        ...localUserData,
        [uid]: {
            ...localUserData[uid],
            [key]: value
        }
    };
    setLocalUserData(updatedData);
    setLocalStorageItem('user_management_data', updatedData);
    toast({ title: 'Saved', description: 'Your changes have been saved to this browser.' });
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
            localUserData[u.uid]?.operativeId || 'N/A', 
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

    const directUsers = users.filter(u => localUserData[u.uid]?.employmentType === 'direct' && isOperative(u));
    const subbieUsers = users.filter(u => localUserData[u.uid]?.employmentType === 'subbie' && isOperative(u));
    const unassignedUsers = users.filter(u => !localUserData[u.uid]?.employmentType && isOperative(u));

    generateTableForType('Direct Employees', directUsers);
    generateTableForType('Subcontractors (Subbies)', subbieUsers);
    generateTableForType('Unassigned', unassignedUsers);
    
    doc.save(`user_directory_${format(generationDate, 'yyyy-MM-dd')}.pdf`);
  };
  
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
                <CardTitle>User Management</CardTitle>
                <CardDescription>
                    View and manage all users. Changes are saved to your browser.
                </CardDescription>
            </div>
            <Button variant="outline" onClick={handleDownloadPdf} disabled={loading || users.length === 0}>
                <Download className="mr-2 h-4 w-4" />
                Download Directory PDF
            </Button>
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
            {/* Desktop View */}
            <div className="hidden md:block border rounded-lg">
                <Table>
                <TableHeader>
                    <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Operative ID</TableHead>
                    <TableHead>Email</TableHead>
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
                                defaultValue={localUserData[user.uid]?.operativeId || ''}
                                onBlur={(e) => handleLocalDataChange(user.uid, 'operativeId', e.target.value)}
                                className="h-8 w-24"
                                placeholder="Set ID"
                                disabled={!isOwner && user.role === 'owner'}
                              />
                            ) : (
                              localUserData[user.uid]?.operativeId || <Badge variant="outline">N/A</Badge>
                            )}
                          </TableCell>
                          <TableCell>{user.email}</TableCell>
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
                                      value={localUserData[user.uid]?.employmentType || ''}
                                      onValueChange={(value: 'direct' | 'subbie') => handleLocalDataChange(user.uid, 'employmentType', value)}
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
                                  <TooltipProvider>
                                      <Tooltip>
                                          <TooltipTrigger asChild>
                                          <Button variant="outline" size="sm" asChild>
                                              <a href={generateConsoleLink(user.uid)} target="_blank" rel="noopener noreferrer">
                                              Manage
                                              <ExternalLink className="ml-2 h-4 w-4" />
                                              </a>
                                          </Button>
                                          </TooltipTrigger>
                                          <TooltipContent>
                                          <p>Open user record in Firebase Auth Console</p>
                                          </TooltipContent>
                                      </Tooltip>
                                  </TooltipProvider>
                              )}
                          </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
                </Table>
            </div>

            {/* Mobile View */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:hidden">
              {users.map((user) => (
                <Card key={user.uid} className={user.status === 'suspended' ? 'bg-muted/50' : ''}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                        <CardTitle className="text-lg">{user.name}</CardTitle>
                        {getStatusBadge(user.status)}
                    </div>
                    <CardDescription>{user.email}</CardDescription>
                  </CardHeader>
                  <CardContent className="text-sm space-y-3">
                     <p><strong>Phone:</strong> {user.phoneNumber || 'N/A'}</p>
                     <p className="flex items-center gap-2"><strong>Role:</strong> <Badge variant={user.role === 'owner' ? 'default' : user.role === 'admin' ? 'secondary' : 'outline'} className="capitalize">{user.role}</Badge></p>
                     
                     {isPrivilegedUser && (
                        <>
                          <div className="flex items-center gap-2 pt-2">
                            <strong className="shrink-0">ID:</strong>
                            <Input
                                defaultValue={localUserData[user.uid]?.operativeId || ''}
                                onBlur={(e) => handleLocalDataChange(user.uid, 'operativeId', e.target.value)}
                                className="h-8"
                                placeholder="Set ID"
                                disabled={!isOwner && user.role === 'owner'}
                              />
                          </div>
                          <div className="flex items-center gap-2 pt-2">
                            <strong className="shrink-0">Type:</strong>
                            <Select
                              value={localUserData[user.uid]?.employmentType || ''}
                              onValueChange={(value: 'direct' | 'subbie') => handleLocalDataChange(user.uid, 'employmentType', value)}
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
                    <CardFooter className="p-2 bg-muted/20">
                      <Button variant="outline" size="sm" asChild>
                          <a href={generateConsoleLink(user.uid)} target="_blank" rel="noopener noreferrer" className="w-full">
                              Manage User in Console
                              <ExternalLink className="ml-2 h-4 w-4" />
                          </a>
                      </Button>
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
