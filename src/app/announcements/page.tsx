'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { format } from 'date-fns';

import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/use-auth';
import type { Announcement } from '@/types';

export default function AnnouncementsPage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const router = useRouter();

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);

  // If not logged in, go to dashboard (which handles sign-in)
  useEffect(() => {
    if (!isAuthLoading && !user) router.replace('/dashboard');
  }, [user, isAuthLoading, router]);

  useEffect(() => {
    if (!user) return;

    const qy = query(collection(db, 'announcements'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(
      qy,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Announcement[];
        setAnnouncements(rows);
        setLoading(false);
      },
      () => setLoading(false)
    );

    return () => unsub();
  }, [user]);

  const hasAnnouncements = useMemo(() => announcements.length > 0, [announcements]);

  if (!user) return null;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <h1 className="text-2xl font-semibold">Announcements</h1>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !hasAnnouncements ? (
        <p className="text-sm text-muted-foreground">No announcements yet.</p>
      ) : (
        <div className="space-y-4">
          {announcements.map((a) => (
            <div key={a.id} className="rounded-lg border p-4 bg-background">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-semibold">{a.title}</h2>
                  <p className="text-xs text-muted-foreground">
                    Posted by {a.authorName || '—'}{' '}
                    {a.createdAt?.toDate ? `on ${format(a.createdAt.toDate(), 'PPP')}` : ''}
                  </p>
                </div>
              </div>
              <div className="mt-3 whitespace-pre-wrap text-sm">{a.content}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
