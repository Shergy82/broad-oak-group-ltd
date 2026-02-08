'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { Spinner } from '@/components/shared/spinner';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Shift, UserProfile } from '@/types';
import { StatsDashboard } from '@/components/dashboard/stats-dashboard';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear } from 'date-fns';

type TimeRange = 'weekly' | 'monthly' | 'yearly';

export default function StatsPage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const router = useRouter();

  const [allShifts, setAllShifts] = useState<Shift[]>([]);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [timeRange, setTimeRange] = useState<TimeRange>('weekly');

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
  
  const filteredShifts = useMemo(() => {
    const now = new Date();
    let start, end;

    if (timeRange === 'weekly') {
      start = startOfWeek(now, { weekStartsOn: 1 });
      end = endOfWeek(now, { weekStartsOn: 1 });
    } else if (timeRange === 'monthly') {
      start = startOfMonth(now);
      end = endOfMonth(now);
    } else { // yearly
      start = startOfYear(now);
      end = endOfYear(now);
    }

    return allShifts.filter(s => {
        const shiftDate = s.date.toDate();
        return shiftDate >= start && shiftDate <= end;
    });
  }, [allShifts, timeRange]);

  const userShifts = useMemo(() => {
    if (!user) return [];
    return filteredShifts.filter(shift => shift.userId === user.uid);
  }, [filteredShifts, user]);

  const isLoading = isAuthLoading || loadingData;

  if (isLoading || !user) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center">
        <Spinner size="lg" />
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col gap-6 p-4 md:p-8">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <h2 className="text-2xl font-bold tracking-tight">Performance Stats</h2>
            <Select value={timeRange} onValueChange={(value) => setTimeRange(value as TimeRange)}>
                <SelectTrigger className="w-full sm:w-[180px]">
                    <SelectValue placeholder="Select time range" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="weekly">This Week</SelectItem>
                    <SelectItem value="monthly">This Month</SelectItem>
                    <SelectItem value="yearly">This Year</SelectItem>
                </SelectContent>
            </Select>
        </div>
        <StatsDashboard
            allShifts={filteredShifts}
            userShifts={userShifts}
            allUsers={allUsers}
            timeRange={timeRange}
        />
    </main>
  );
}
