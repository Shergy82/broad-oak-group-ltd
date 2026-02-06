'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  collection,
  onSnapshot,
  query,
  where,
  orderBy,
  Timestamp,
} from 'firebase/firestore';

import { useAuth } from '@/hooks/use-auth';
import { Spinner } from '@/components/shared/spinner';
import { db } from '@/lib/firebase';
import type { Shift } from '@/types';

if (!db) throw new Error('Firestore db not initialized');

type SiteRow = {
  key: string;
  address: string;
  lastShiftEnd: number;
  operatives: string[];
};

function toMs(v: any): number | null {
  if (!v) return null;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  if (typeof v?.toDate === 'function') return v.toDate().getTime(); // Timestamp
  return null;
}

function getAddress(shift: any): string {
  return (
    shift?.address ||
    shift?.siteAddress ||
    shift?.propertyAddress ||
    shift?.site?.address ||
    shift?.projectAddress ||
    'Unknown address'
  );
}

function getOperatives(shift: any): string[] {
  const ops = shift?.operatives || shift?.operativeNames || shift?.workers;
  if (Array.isArray(ops)) return ops.map(String);

  const maybeUsers = shift?.assignedUserIds || shift?.assignedUsers;
  if (Array.isArray(maybeUsers)) return maybeUsers.map(String);

  return [];
}

function getEndMs(shift: any): number | null {
  return (
    toMs(shift?.endDate) ??
    toMs(shift?.end) ??
    toMs(shift?.endTime) ??
    toMs(shift?.date) // fallback
  );
}

export default function SiteSchedulePage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const router = useRouter();

  const [allShifts, setAllShifts] = useState<Shift[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    if (!isAuthLoading && !user) router.push('/login');
  }, [user, isAuthLoading, router]);

  useEffect(() => {
    if (!user) {
      setLoadingData(false);
      return;
    }

    setLoadingData(true);

    // Keep showing sites until the day after last shift:
    // We filter out shifts whose end is BEFORE yesterday.
    const yesterday = Timestamp.fromDate(
      new Date(Date.now() - 24 * 60 * 60 * 1000)
    );

    const shiftsQuery = query(
      collection(db, 'shifts'),
      where('userId','==', user.uid),
      where('date','>=', yesterday),
      orderBy('date','asc')
    );

    const unsub = onSnapshot(
      shiftsQuery,
      (snapshot) => {
        setAllShifts(
          snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Shift))
        );
        setLoadingData(false);
      },
      (error) => {
        console.error('Error fetching user shifts:', error);
        setLoadingData(false);
      }
    );

    return () => unsub();
  }, [user]);

  const sites = useMemo<SiteRow[]>(() => {
    const map = new Map<
      string,
      { address: string; lastShiftEnd: number; operatives: Set<string> }
    >();

    for (const s of allShifts as any[]) {
      const address = getAddress(s);
      const key = address.trim().toLowerCase();
      const endMs = getEndMs(s) ?? 0;

      if (!map.has(key)) {
        map.set(key, { address, lastShiftEnd: endMs, operatives: new Set() });
      }

      const row = map.get(key)!;
      row.lastShiftEnd = Math.max(row.lastShiftEnd, endMs);

      for (const op of getOperatives(s)) row.operatives.add(op);
    }

    // Apply "until the day after last shift" at site level too
    const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;

    return Array.from(map.entries())
      .map(([key, v]) => ({
        key,
        address: v.address,
        lastShiftEnd: v.lastShiftEnd,
        operatives: Array.from(v.operatives).sort(),
      }))
      .filter((r) => r.lastShiftEnd >= cutoffMs)
      .sort((a, b) => b.lastShiftEnd - a.lastShiftEnd);
  }, [allShifts]);

  const isLoading = isAuthLoading || loadingData;

  if (isLoading || !user) {
    return (
      <div className="flex min-h-screen w-full flex-col items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full flex-col">
      <main className="flex flex-1 flex-col gap-6 p-4 md:p-8">
        <h1 className="text-2xl font-semibold">Site Schedule</h1>

        {sites.length === 0 ? (
          <p className="text-muted-foreground">No active sites assigned.</p>
        ) : (
          <ul className="space-y-3">
            {sites.map((site) => (
              <li
                key={site.key}
                className="border rounded-lg p-4 hover:bg-muted cursor-pointer"
                onClick={() =>
                  router.push(
                    `/site-schedule/${encodeURIComponent(site.address)}`
                  )
                }
              >
                <div className="font-medium">{site.address}</div>
                <div className="text-sm text-muted-foreground">
                  Operatives: {site.operatives.join(', ') || '—'}
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
