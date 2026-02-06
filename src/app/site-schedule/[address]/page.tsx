'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { collection, onSnapshot, query, where, Timestamp } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/use-auth';
import { Spinner } from '@/components/shared/spinner';
import type { Shift } from '@/types';

if (!db) throw new Error('Firestore db not initialized');

function getCorrectedLocalDate(date: { toDate: () => Date }): Date {
  const d = date.toDate();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

export default function SiteScheduleAddressPage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const router = useRouter();
  const params = useParams<{ address: string }>();
  const address = decodeURIComponent(params.address || '');

  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuthLoading && !user) router.push('/login');
  }, [user, isAuthLoading, router]);

  useEffect(() => {
    if (!user || !address) {
      setLoading(false);
      return;
    }

    setLoading(true);

    const startOfYesterday = new Date();
    startOfYesterday.setHours(0, 0, 0, 0);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    const yesterday = Timestamp.fromDate(startOfYesterday);

    const q = query(
      collection(db, 'shifts'),
      where('address', '==', address),
      where('date', '>=', yesterday)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        setShifts(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Shift)));
        setLoading(false);
      },
      (err) => {
        console.error('Error fetching site shifts:', err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [user, address]);

  const operatives = useMemo(() => {
    const set = new Set<string>();
    for (const s of shifts as any[]) {
      const ops = s.operatives || s.operativeNames || [];
      if (Array.isArray(ops)) ops.forEach((o: any) => set.add(String(o)));
      if (s.userName) set.add(String(s.userName));
    }
    return Array.from(set).sort();
  }, [shifts]);

  if (isAuthLoading || loading || !user) {
    return (
      <div className="flex min-h-screen w-full flex-col items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <button className="text-sm underline mb-4" onClick={() => router.push('/site-schedule')}>
        Back
      </button>

      <h1 className="text-2xl font-semibold mb-2">{address}</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Operatives: {operatives.join(', ') || '—'}
      </p>

      {shifts.length === 0 ? (
        <p className="text-muted-foreground">No recent shifts for this site.</p>
      ) : (
        <ul className="space-y-3">
          {shifts
            .slice()
            .sort((a: any, b: any) => getCorrectedLocalDate(a.date).getTime() - getCorrectedLocalDate(b.date).getTime())
            .map((s: any) => (
              <li key={s.id} className="border rounded-lg p-4">
                <div className="font-medium">
                  {getCorrectedLocalDate(s.date).toDateString()} — {s.type || 'Shift'}
                </div>
                <div className="text-sm text-muted-foreground">
                  {s.task || s.description || ''}
                </div>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
