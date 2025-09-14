
'use client';

import { useEffect, useState } from 'react';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '@/lib/firebase';
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
import { ExternalLink } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

export default function UserManagementPage() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const { userProfile: currentUserProfile } = useUserProfile();
  const { toast } = useToast();
  const isOwner = currentUserProfile?.role === 'owner';

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
    if (!projectId) return '#';
    return `https://console.firebase.google.com/project/${projectId}/firestore/data/~2Fusers~2F${uid}`;
  }

  const renderManageButton = (user: UserProfile) => {
     if (isOwner && user.uid !== currentUserProfile?.uid && isFirebaseConfigured) {
       return (
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
                <p>Open user record in Firebase Console</p>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
       )
     }
     return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>User Management</CardTitle>
        <CardDescription>
            View all users and their assigned roles. {isOwner ? "As the owner, you can use the 'Manage' button to open a user's record in the Firebase Console to modify or delete it." : "Only the account owner can manage users."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
            <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
            </div>
        ) : (
          <>
            {/* Desktop View */}
            <div className="hidden md:block border rounded-lg">
                <Table>
                <TableHeader>
                    <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Date Joined</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Phone Number</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    {isOwner && <TableHead className="text-right">Actions</TableHead>}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {users.map((user) => (
                        <TableRow key={user.uid} className={user.status === 'suspended' ? 'bg-muted/30' : ''}>
                        <TableCell className="font-medium">{user.name}</TableCell>
                        <TableCell>{user.createdAt?.toDate().toLocaleDateString() ?? 'N/A'}</TableCell>
                        <TableCell>{user.email}</TableCell>
                        <TableCell>{user.phoneNumber}</TableCell>
                        <TableCell>
                            <Badge variant={user.role === 'owner' ? 'default' : user.role === 'admin' ? 'secondary' : 'outline'} className="capitalize">
                                {user.role}
                            </Badge>
                        </TableCell>
                        <TableCell>
                            {getStatusBadge(user.status)}
                        </TableCell>
                        <TableCell className="text-right">
                           {renderManageButton(user)}
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
                  <CardContent className="text-sm space-y-2">
                     <p><strong>Phone:</strong> {user.phoneNumber || 'N/A'}</p>
                     <p><strong>Joined:</strong> {user.createdAt?.toDate().toLocaleDateString() ?? 'N/A'}</p>
                      <p className="flex items-center gap-2"><strong>Role:</strong> <Badge variant={user.role === 'owner' ? 'default' : user.role === 'admin' ? 'secondary' : 'outline'} className="capitalize">{user.role}</Badge></p>
                  </CardContent>
                  {isOwner && user.uid !== currentUserProfile?.uid && (
                    <CardFooter className="p-2 bg-muted/20">
                      {renderManageButton(user)}
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
