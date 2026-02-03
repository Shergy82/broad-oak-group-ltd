
'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { Header } from '@/components/layout/header';
import { Spinner } from '@/components/shared/spinner';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Shift, UserProfile } from '@/types';
import { PerformanceAwards } from '@/components/dashboard/performance-awards';
import { UserStatsDashboard } from '@/components/dashboard/user-stats-dashboard';

export default function StatsPage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const router = useRouter();

  const [allShifts, setAllShifts] = useState<Shift[]>([]);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    if (!isAuthLoading && !user) {
      router.push('/login');
    }
  }, [user, isAuthLoading, router]);

  useEffect(() => {
    if (!user || !db) {
      setLoadingData(false);
      return;
    }
    setLoadingData(true);

    const shiftsQuery = query(collection(db, 'shifts'));
    const usersQuery = query(collection(db, 'users'));

    let shiftsLoaded = false;
    let usersLoaded = false;

    const checkAllDataLoaded = () => {
        if (shiftsLoaded && usersLoaded) {
            setLoadingData(false);
        }
    };

    const unsubShifts = onSnapshot(shiftsQuery, (snapshot) => {
        setAllShifts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Shift)));
        shiftsLoaded = true;
        checkAllDataLoaded();
    }, (error) => {
        console.error("Error fetching shifts:", error);
        shiftsLoaded = true;
        checkAllDataLoaded();
    });

    const unsubUsers = onSnapshot(usersQuery, (snapshot) => {
        setAllUsers(snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile)));
        usersLoaded = true;
        checkAllDataLoaded();
    }, (error) => {
        console.error("Error fetching users:", error);
        usersLoaded = true;
        checkAllDataLoaded();
    });

    return () => {
      unsubShifts();
      unsubUsers();
    };
  }, [user]);

  const userShifts = useMemo(() => {
      if (!user) return [];
      return allShifts.filter(shift => shift.userId === user.uid);
  }, [allShifts, user]);
  
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
      <Header />
      <main className="flex flex-1 flex-col gap-6 p-4 md:p-8">
        <PerformanceAwards allShifts={allShifts} allUsers={allUsers} />
        <UserStatsDashboard allShifts={userShifts} />
      </main>
    </div>
  );
}
