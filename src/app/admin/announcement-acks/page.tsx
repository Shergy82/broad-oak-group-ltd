'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { format } from 'date-fns';

import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/use-auth';
import { useUserProfile } from '@/hooks/use-user-profile';
import { Button } from '@/components/ui/button';

type Ann = { id: string; title?: string; createdAt?: any };
type Ack = { id: string; announcementId: string; userId: string; name?: string; acknowledgedAt?: any };

function toCsvCell(v: any) {
  const s = (v ?? '').toString().replaceAll('"', '""');
  return `"${s}"`;
}

export default function AnnouncementAcksAdminPage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const { userProfile, loading: profileLoading } = useUserProfile();

  const [anns, setAnns] = useState<Ann[]>([]);
  const [acks, setAcks] = useState<Ack[]>([]);
  const [loading, setLoading] = useState(true);

  // IMPORTANT: don't block UI on profileLoading; treat missing profile as non-privileged
  const role = (userProfile?.role || '').toLowerCase();
  const isPrivileged = role === 'owner' || role === 'admin' || role === 'manager';

  useEffect(() => {
    async function load() {
      if (!user) return;
      setLoading(true);
      try {
        const annSnap = await getDocs(
          query(collection(db, 'announcements'), orderBy('createdAt', 'desc'))
        );
        const ackSnap = await getDocs(query(collection(db, 'announcementAcknowledgements')));

        setAnns(
          annSnap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as any),
          }))
        );

        setAcks(
          ackSnap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as any),
          }))
        );
      } finally {
        setLoading(false);
      }
    }

    // Only wait for auth; profile can load later
    if (!isAuthLoading && user) load();
  }, [user, isAuthLoading]);

  const csv = useMemo(() => {
    const annById = new Map<string, Ann>(anns.map((a) => [a.id, a]));

    if (!isPrivileged) return '';

    const header = ['announcementTitle', 'announcementCreatedAt', 'name', 'acknowledgedAt'].join(',');

    const rows = acks
      .slice()
      .sort(
        (a, b) =>
          (b.acknowledgedAt?.toMillis?.() ?? 0) - (a.acknowledgedAt?.toMillis?.() ?? 0)
      )
      .map((ack) => {
        const ann = annById.get(ack.announcementId);

        const annCreated = ann?.createdAt?.toDate
          ? format(ann.createdAt.toDate(), 'yyyy-MM-dd HH:mm')
          : '';

        const ackedAt = ack.acknowledgedAt?.toDate
          ? format(ack.acknowledgedAt.toDate(), 'yyyy-MM-dd HH:mm')
          : '';

        return [
          toCsvCell(ann?.title || ''),
          toCsvCell(annCreated),
          toCsvCell(ack.name || ''),
          toCsvCell(ackedAt),
        ].join(',');
      });

    return [header, ...rows].join('\n');
  }, [anns, acks, isPrivileged]);

  function downloadCsv() {
    if (!isPrivileged) return;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `announcement-acknowledgements-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!user) return null;

  // Only block on auth; profile can be slow/missing
  if (isAuthLoading) {
    return <div className="p-6">Loading…</div>;
  }

  // If profile is still loading, show a lightweight message instead of an infinite spinner
  if (profileLoading) {
    return <div className="p-6">Loading…</div>;
  }

  if (!isPrivileged) {
    return <div className="p-6">You don’t have access to this page.</div>;
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Announcement Acknowledgements</h1>
        <Button onClick={downloadCsv} disabled={loading || acks.length === 0 || !csv}>
          {loading ? 'Loading…' : 'Download CSV'}
        </Button>
      </div>

      <div className="text-sm text-muted-foreground">Records: {loading ? '—' : acks.length}</div>

      {!loading && acks.length === 0 && (
        <div className="text-sm text-muted-foreground">No acknowledgements yet.</div>
      )}
    </div>
  );
}
