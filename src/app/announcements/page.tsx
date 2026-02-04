
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { format } from 'date-fns';

import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/use-auth';
import type { Announcement } from '@/types';

import {
  acknowledgeAnnouncement,
  hasAcknowledged,
} from '@/hooks/use-announcements-ack';

import { Button } from '@/components/ui/button';

export default function AnnouncementsPage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const router = useRouter();

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [ack, setAck] = useState<Record<string, boolean>>({});

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

      for (const a of announcements) {
        const ok = await hasAcknowledged(a.id, user);
        setAck((p) => ({ ...p, [a.id]: ok }));
      }
    }

    if (announcements.length) load();
  }, [announcements, user]);

  const hasAnnouncements = useMemo(
    () => announcements.length > 0,
    [announcements]
  );

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
            <div
              key={a.id}
              className="rounded-lg border p-4 bg-background space-y-3"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-semibold">{a.title}</h2>
                  <p className="text-xs text-muted-foreground">
                    Posted by {a.authorName || '—'}{' '}
                    {a.createdAt?.toDate
                      ? `on ${format(a.createdAt.toDate(), 'PPP')}`
                      : ''}
                  </p>
                </div>

                <Button
                  size="sm"
                  disabled={ack[a.id]}
                  onClick={async () => {
                    if (!user) return;

                    await acknowledgeAnnouncement(
                      a.id,
                      user,
                      user.displayName || 'Unknown'
                    );

                    setAck((p) => ({ ...p, [a.id]: true }));
                  }}
                >
                  {ack[a.id] ? 'Acknowledged ✅' : 'Acknowledge'}
                </Button>
              </div>

              <div className="whitespace-pre-wrap text-sm">
                {a.content}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

