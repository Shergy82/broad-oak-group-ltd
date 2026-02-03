
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { collection, onSnapshot, query, orderBy, doc, deleteDoc } from 'firebase/firestore';
import { format } from 'date-fns';
import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/use-auth';
import { useUserProfile } from '@/hooks/use-user-profile';
import { Header } from '@/components/layout/header';
import { Spinner } from '@/components/shared/spinner';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Megaphone, PlusCircle, Trash2, Edit } from 'lucide-react';
import { AnnouncementForm } from '@/components/admin/announcement-form';
import type { Announcement } from '@/types';
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

export default function AnnouncementsPage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const { userProfile, loading: isProfileLoading } = useUserProfile();
  const router = useRouter();
  const { toast } = useToast();

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loadingAnnouncements, setLoadingAnnouncements] = useState(true);
  
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null);

  const isPrivilegedUser = userProfile && ['admin', 'owner', 'manager'].includes(userProfile.role);

  useEffect(() => {
    if (!isAuthLoading && !user) {
      router.push('/login');
    }
  }, [user, isAuthLoading, router]);

  useEffect(() => {
    if (!db) {
        setLoadingAnnouncements(false);
        return;
    }
    const announcementsQuery = query(collection(db, 'announcements'), orderBy('createdAt', 'desc'));

    const unsubscribeAnnouncements = onSnapshot(announcementsQuery, (snapshot) => {
      const fetchedAnnouncements = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Announcement));
      setAnnouncements(fetchedAnnouncements);
      setLoadingAnnouncements(false);
    }, (error) => {
      console.error("Error fetching announcements:", error);
      toast({ variant: 'destructive', title: 'Error', description: 'Could not fetch announcements.' });
      setLoadingAnnouncements(false);
    });

    return () => {
        unsubscribeAnnouncements();
    };
  }, [toast]);
  
  const handleCreate = () => {
    setSelectedAnnouncement(null);
    setIsFormOpen(true);
  }

  const handleEdit = (announcement: Announcement) => {
    setSelectedAnnouncement(announcement);
    setIsFormOpen(true);
  }

  const handleDelete = async (announcementId: string) => {
    if (!isPrivilegedUser) {
        toast({ variant: 'destructive', title: 'Permission Denied', description: 'You cannot delete this.' });
        return;
    }
    if (!db) {
        toast({ variant: 'destructive', title: 'Error', description: 'Database service is not available.' });
        return;
    }

    toast({ title: 'Deleting...', description: 'Please wait while the announcement is deleted.' });
    try {
        await deleteDoc(doc(db, 'announcements', announcementId));
        toast({ title: 'Success', description: 'Announcement has been deleted.' });
    } catch (error: any) {
        console.error('Error deleting announcement:', error);
        toast({ variant: 'destructive', title: 'Deletion Failed', description: error.message || 'Could not delete announcement.' });
    }
  }
  
  const isLoadingPage = isAuthLoading || isProfileLoading;

  if (isLoadingPage) {
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
              {loadingAnnouncements ? (
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
                  {announcements.map(announcement => (
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
                        <CardFooter className="flex justify-end gap-2 bg-muted/30 p-3 border-t">
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
                        </CardFooter>
                      )}
                    </Card>
                  ))}
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
