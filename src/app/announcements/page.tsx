'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { collection, onSnapshot, orderBy, query, deleteDoc, doc } from 'firebase/firestore';
import { format } from 'date-fns';
import { PlusCircle, Edit, Trash2 } from 'lucide-react';

import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/use-auth';
import { useUserProfile } from '@/hooks/use-user-profile';
import type { Announcement } from '@/types';
import { useToast } from '@/hooks/use-toast';

import { acknowledgeAnnouncement, hasAcknowledged } from '@/hooks/use-announcements-ack';
import { AnnouncementAckReport } from '@/components/admin/announcement-ack-report';
import { Button } from '@/components/ui/button';
import { AnnouncementForm } from '@/components/admin/announcement-form';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";


export default function AnnouncementsPage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const { userProfile, loading: profileLoading } = useUserProfile();
  const router = useRouter();
  const { toast } = useToast();

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [ack, setAck] = useState<Record<string, boolean>>({});
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null);

  const [hideAcknowledged, setHideAcknowledged] = useState(true);

  const role = (userProfile?.role || '').toLowerCase();
  const isPrivileged = role === 'owner' || role === 'admin' || role === 'manager' || role === 'tlo';

  useEffect(() => {
    if (!isAuthLoading && !user) router.replace('/dashboard');
  }, [user, isAuthLoading, router]);

  useEffect(() => {
    if (!user) return;

    const qy = query(collection(db, 'announcements'), orderBy('createdAt', 'desc'));

    const unsub = onSnapshot(
      qy,
      (snap) => {
        const rows = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        })) as Announcement[];

        setAnnouncements(rows);
        setLoading(false);
      },
      () => setLoading(false)
    );

    return () => unsub();
  }, [user]);

  useEffect(() => {
    async function load() {
      if (!user) return;

      const results = await Promise.all(
        announcements.map(async (a) => [a.id, await hasAcknowledged(a.id, user)] as const)
      );

      setAck((prev) => {
        const next = { ...prev };
        for (const [id, ok] of results) next[id] = ok;
        return next;
      });
    }

    if (announcements.length) load();
  }, [announcements, user]);
  
  const handleAdd = () => {
    setSelectedAnnouncement(null);
    setIsFormOpen(true);
  };

  const handleEdit = (announcement: Announcement) => {
    setSelectedAnnouncement(announcement);
    setIsFormOpen(true);
  };

  const handleDelete = async (announcementId: string) => {
    if (!db) return;
    try {
      await deleteDoc(doc(db, 'announcements', announcementId));
      toast({ title: 'Success', description: 'Announcement deleted.' });
    } catch (error) {
      console.error('Error deleting announcement: ', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Could not delete announcement.',
      });
    }
  };


  const visibleAnnouncements = useMemo(() => {
    if (!isPrivileged) return announcements.filter((a) => !ack[a.id]);

    if (!hideAcknowledged) return announcements;
    return announcements.filter((a) => !ack[a.id]);
  }, [announcements, ack, hideAcknowledged, isPrivileged]);

  const hasAnnouncements = useMemo(() => visibleAnnouncements.length > 0, [visibleAnnouncements]);

  if (!user) return null;

  return (
    <>
      <div className="p-6 max-w-4xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold">Announcements</h1>

          <div className="flex items-center gap-2">
            {isPrivileged && (
              <Button size="sm" variant="outline" onClick={() => setHideAcknowledged((v) => !v)}>
                {hideAcknowledged ? 'Showing: Unacknowledged' : 'Showing: All'}
              </Button>
            )}
             {isPrivileged && (
              <Button size="sm" onClick={handleAdd}>
                <PlusCircle className="mr-2 h-4 w-4" /> Create
              </Button>
            )}
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !hasAnnouncements ? (
          <p className="text-sm text-muted-foreground">
            {isPrivileged && !hideAcknowledged
              ? 'No announcements yet.'
              : 'No unacknowledged announcements.'}
          </p>
        ) : (
          <div className="space-y-4">
            {visibleAnnouncements.map((a) => (
              <div key={a.id} className="rounded-lg border p-4 bg-background space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="font-semibold">{a.title}</h2>
                    <p className="text-xs text-muted-foreground">
                      Posted by {a.authorName || '—'}{' '}
                      {a.createdAt?.toDate ? `on ${format(a.createdAt.toDate(), 'PPP')}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-0">
                    {!isPrivileged ? (
                      <Button
                        size="sm"
                        disabled={!!ack[a.id]}
                        onClick={async () => {
                          if (!user) return;
                          await acknowledgeAnnouncement(a.id, user, user.displayName || 'Unknown');
                          setAck((p) => ({ ...p, [a.id]: true }));
                        }}
                      >
                        {ack[a.id] ? 'Acknowledged ✅' : 'Acknowledge'}
                      </Button>
                    ) : (
                       <>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(a)}>
                            <Edit className="h-4 w-4" />
                        </Button>
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive/70 hover:text-destructive hover:bg-destructive/10">
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    This will permanently delete the announcement "{a.title}".
                                </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => handleDelete(a.id)} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">Delete</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    </>
                    )}
                  </div>
                </div>

                <div className="whitespace-pre-wrap text-sm">{a.content}</div>

                {isPrivileged && (
                  <div className="pt-2">
                    <AnnouncementAckReport announcementId={a.id} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {userProfile && (
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
