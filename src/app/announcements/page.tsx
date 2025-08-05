'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { collection, onSnapshot, query, orderBy, doc, deleteDoc, updateDoc, arrayUnion, writeBatch, Timestamp } from 'firebase/firestore';
import { format, formatDistanceToNow } from 'date-fns';
import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/use-auth';
import { useUserProfile } from '@/hooks/use-user-profile';
import { Header } from '@/components/layout/header';
import { Spinner } from '@/components/shared/spinner';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Megaphone, PlusCircle, Trash2, Edit, Eye } from 'lucide-react';
import { AnnouncementForm } from '@/components/admin/announcement-form';
import type { Announcement, UserProfile } from '@/types';
import { useToast } from '@/hooks/use-toast';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger
} from "@/components/ui/alert-dialog"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Avatar, AvatarFallback } from '@/components/ui/avatar';


export default function AnnouncementsPage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const { userProfile, loading: isProfileLoading } = useUserProfile();
  const router = useRouter();
  const { toast } = useToast();

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null);

  const isPrivilegedUser = userProfile && ['admin', 'owner'].includes(userProfile.role);

  const userNameMap = useMemo(() => new Map(users.map(u => [u.uid, u.name])), [users]);
  
  const getInitials = (name?: string) => {
    if (!name) return '??';
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase();
  };

  useEffect(() => {
    if (!isAuthLoading && !user) {
      router.push('/login');
    }
  }, [user, isAuthLoading, router]);

  useEffect(() => {
    if (!db) {
        setLoading(false);
        return;
    }
    const announcementsQuery = query(collection(db, 'announcements'), orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(announcementsQuery, (snapshot) => {
      const fetchedAnnouncements = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Announcement));
      setAnnouncements(fetchedAnnouncements);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching announcements:", error);
      toast({ variant: 'destructive', title: 'Error', description: 'Could not fetch announcements.' });
      setLoading(false);
    });

    // Fetch all users if the current user is an admin/owner to display viewer names
    let unsubscribeUsers = () => {};
    if (isPrivilegedUser) {
        const usersQuery = query(collection(db, 'users'));
        unsubscribeUsers = onSnapshot(usersQuery, (snapshot) => {
            setUsers(snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile)));
        });
    }

    return () => {
        unsubscribe();
        unsubscribeUsers();
    };
  }, [toast, isPrivilegedUser]);

  useEffect(() => {
    if (user && userProfile && !isPrivilegedUser && announcements.length > 0) {
      const batch = writeBatch(db);
      const announcementsToUpdate = announcements.filter(announcement => {
        // Ensure viewedBy exists and check if the user's ID is in the keys.
        return !announcement.viewedBy || !Object.keys(announcement.viewedBy).includes(user.uid);
      });

      if (announcementsToUpdate.length > 0) {
        announcementsToUpdate.forEach(announcement => {
          const announcementRef = doc(db, 'announcements', announcement.id);
          const newViewEntry = `viewedBy.${user.uid}`;
          batch.update(announcementRef, { [newViewEntry]: Timestamp.now() });
        });

        batch.commit().catch(err => {
          console.error("Failed to mark announcements as viewed:", err);
        });
      }
    }
  }, [announcements, user, userProfile, isPrivilegedUser]);
  
  const handleCreate = () => {
    setSelectedAnnouncement(null);
    setIsFormOpen(true);
  }

  const handleEdit = (announcement: Announcement) => {
    setSelectedAnnouncement(announcement);
    setIsFormOpen(true);
  }

  const handleDelete = async (announcementId: string) => {
    if (!db) return;
    try {
        await deleteDoc(doc(db, 'announcements', announcementId));
        toast({ title: 'Success', description: 'Announcement deleted.' });
    } catch (error) {
        toast({ variant: 'destructive', title: 'Error', description: 'Could not delete announcement.' });
    }
  }
  
  const isLoadingPage = isAuthLoading || isProfileLoading || (loading && announcements.length === 0);

  if (isLoadingPage && !user) {
    return (
      <div className="flex min-h-screen w-full flex-col items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <>
      <div className="flex min-h-screen w-full flex-col">
        <Header />
        <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
          <Card>
            <CardHeader className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <CardTitle>Announcements</CardTitle>
                <CardDescription>Important updates and announcements for the team.</CardDescription>
              </div>
              {isPrivilegedUser && (
                <Button onClick={handleCreate}>
                  <PlusCircle className="mr-2 h-4 w-4" />
                  Create Announcement
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {isLoadingPage ? (
                <div className="flex items-center justify-center p-12">
                  <Spinner />
                </div>
              ) : announcements.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
                  <Megaphone className="mx-auto h-12 w-12 text-muted-foreground" />
                  <h3 className="mt-4 text-lg font-semibold">No Announcements Yet</h3>
                  <p className="mb-4 mt-2 text-sm text-muted-foreground">
                    {isPrivilegedUser ? 'Create one using the button above.' : 'Check back here for important updates.'}
                  </p>
                </div>
              ) : (
                <div className="space-y-6">
                  {announcements.map(announcement => {
                    const viewedByCount = announcement.viewedBy ? Object.keys(announcement.viewedBy).length : 0;
                    const viewers = announcement.viewedBy ? Object.entries(announcement.viewedBy).map(([uid, timestamp]) => ({
                        uid,
                        name: userNameMap.get(uid) || 'Unknown User',
                        viewedAt: timestamp
                    })).sort((a,b) => b.viewedAt.toMillis() - a.viewedAt.toMillis()) : [];

                    return (
                        <Card key={announcement.id} className="shadow-sm">
                          <CardHeader>
                            <CardTitle>{announcement.title}</CardTitle>
                            <CardDescription>
                              Posted by {announcement.authorName} {announcement.createdAt ? `on ${format(announcement.createdAt.toDate(), 'PPP')}` : ''}
                            </CardDescription>
                          </CardHeader>
                          <CardContent>
                            <p className="whitespace-pre-wrap text-sm">{announcement.content}</p>
                          </CardContent>
                          {isPrivilegedUser && (
                            <CardFooter className="flex-col items-stretch p-0">
                                <div className="flex justify-end gap-2 bg-muted/30 p-3">
                                   <Button variant="outline" size="sm" onClick={() => handleEdit(announcement)}>
                                     <Edit className="mr-2 h-4 w-4" />
                                     Edit
                                   </Button>
                                   <AlertDialog>
                                      <AlertDialogTrigger asChild>
                                          <Button variant="destructive" size="sm">
                                              <Trash2 className="mr-2 h-4 w-4" />
                                              Delete
                                          </Button>
                                      </AlertDialogTrigger>
                                      <AlertDialogContent>
                                          <AlertDialogHeader>
                                              <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                                              <AlertDialogDescription>
                                                  This action cannot be undone. This will permanently delete the announcement titled "{announcement.title}".
                                              </AlertDialogDescription>
                                          </AlertDialogHeader>
                                          <AlertDialogFooter>
                                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                                              <AlertDialogAction onClick={() => handleDelete(announcement.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                                  Delete
                                              </AlertDialogAction>
                                          </AlertDialogFooter>
                                      </AlertDialogContent>
                                   </AlertDialog>
                                </div>
                                {viewedByCount > 0 && (
                                <Accordion type="single" collapsible className="w-full">
                                    <AccordionItem value="item-1" className="border-t">
                                        <AccordionTrigger className="px-4 py-2 text-sm hover:no-underline bg-muted/50">
                                            <div className="flex items-center gap-2">
                                                <Eye className="h-4 w-4" />
                                                Viewed by {viewedByCount} user(s)
                                            </div>
                                        </AccordionTrigger>
                                        <AccordionContent className="p-4 bg-muted/20 max-h-60 overflow-y-auto">
                                            <ul className="space-y-3">
                                                {viewers.map(viewer => (
                                                    <li key={viewer.uid} className="flex items-center justify-between">
                                                        <div className="flex items-center gap-3">
                                                            <Avatar className="h-8 w-8 text-xs">
                                                                <AvatarFallback>{getInitials(viewer.name)}</AvatarFallback>
                                                            </Avatar>
                                                            <span className="font-medium text-sm">{viewer.name}</span>
                                                        </div>
                                                        <span className="text-xs text-muted-foreground">
                                                            {formatDistanceToNow(viewer.viewedAt.toDate(), { addSuffix: true })}
                                                        </span>
                                                    </li>
                                                ))}
                                            </ul>
                                        </AccordionContent>
                                    </AccordionItem>
                                </Accordion>
                                )}
                            </CardFooter>
                          )}
                        </Card>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </main>
      </div>
      
      {isPrivilegedUser && userProfile && (
         <AnnouncementForm
            currentUser={userProfile}
            announcement={selectedAnnouncement}
            open={isFormOpen}
            onOpenChange={setIsFormOpen}
          />
      )}
    </>
  );
}
