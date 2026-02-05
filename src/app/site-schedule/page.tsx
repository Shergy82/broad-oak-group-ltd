'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { collection, onSnapshot, query, where, orderBy } from 'firebase/firestore';

import { useAuth } from '@/hooks/use-auth';
import { Spinner } from '@/components/shared/spinner';
import Dashboard from '@/components/dashboard/index';
import { db } from '@/lib/firebase';
import type { Shift } from '@/types';

export default function SiteSchedulePage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const router = useRouter();

  const [allShifts, setAllShifts] = useState<Shift[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    if (!isAuthLoading && !user) router.push('/login');
  }, [user, isAuthLoading, router]);

  useEffect(() => {
    if (!user || !db) {
      setLoadingData(false);
      return;
    }

    setLoadingData(true);

    const shiftsQuery = query(
      collection(db, 'shifts'),
      where('userId', '==', user.uid),
      orderBy('date', 'asc')
    );

    const unsubShifts = onSnapshot(
      shiftsQuery,
      (snapshot) => {
        setAllShifts(snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Shift)));
        setLoadingData(false);
      },
      (error) => {
        console.error('Error fetching user shifts:', error);
        setLoadingData(false);
      }
    );

    return () => unsubShifts();
  }, [user]);

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
        <Dashboard userShifts={allShifts} loading={loadingData} />
      </main>
    </div>
  );
}
