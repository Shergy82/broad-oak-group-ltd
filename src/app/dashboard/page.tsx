'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useUserProfile } from '@/hooks/use-user-profile';
import Dashboard from '@/components/dashboard/index';
import { Header } from '@/components/layout/header';
import { Spinner } from '@/components/shared/spinner';
import { collection, onSnapshot, query, orderBy, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Announcement, Shift } from '@/types';
import { UnreadAnnouncements } from '@/components/announcements/unread-announcements';
import { NewShiftsDialog } from '@/components/dashboard/new-shifts-dialog';
import { getCorrectedLocalDate } from '@/lib/utils';

export default function DashboardPage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const { userProfile, loading: isProfileLoading } = useUserProfile();
  const router = useRouter();

  const searchParams = useSearchParams();
  const gatePending = searchParams.get('gate') === 'pending';

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [allShifts, setAllShifts] = useState<Shift[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [showAnnouncements, setShowAnnouncements] = useState(true);
  const [showNewShifts, setShowNewShifts] = useState(true);
  const [acknowledgedIds, setAcknowledgedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (user) {
      try {
        const stored = localStorage.getItem(`acknowledgedAnnouncements_${user.uid}`);
        if (stored) {
          setAcknowledgedIds(new Set(JSON.parse(stored)));
        }
      } catch (e) {
        console.error("Failed to parse acknowledged announcements from localStorage", e);
        setAcknowledgedIds(new Set());
      }
    }
  }, [user]);

  const handleAnnouncementsClose = () => {
    if (user) {
      try {
        const stored = localStorage.getItem(`acknowledgedAnnouncements_${user.uid}`);
        if (stored) {
          setAcknowledgedIds(new Set(JSON.parse(stored)));
        }
      } catch (e) {
         console.error("Failed to parse acknowledged announcements from localStorage", e);
      }
    }
    setShowAnnouncements(false);
  };

  useEffect(() => {
    if (!isAuthLoading && !user) {
      router.push('/login');
    }
  }, [user, isAuthLoading, router]);

  useEffect(() => {
    if (!user) return;
    if (gatePending) {
      setShowNewShifts(true);
      setShowAnnouncements(false);
    }
  }, [gatePending, user]);

  useEffect(() => {
    if (!user || !db) {
      setLoadingData(false);
      return;
    }
    setLoadingData(true);

    const announcementsQuery = query(
      collection(db, 'announcements'),
      orderBy('createdAt', 'desc')
    );
    const shiftsQuery = query(collection(db, 'shifts'), where('userId', '==', user.uid));

    let announcementsLoaded = false;
    let shiftsLoaded = false;

    const checkAllDataLoaded = () => {
      if (announcementsLoaded && shiftsLoaded) {
        setLoadingData(false);
      }
    };

    const unsubAnnouncements = onSnapshot(
      announcementsQuery,
      (snapshot) => {
        setAnnouncements(
          snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Announcement))
        );
        announcementsLoaded = true;
        checkAllDataLoaded();
      },
      (error) => {
        console.error('Error fetching announcements:', error);
        announcementsLoaded = true;
        checkAllDataLoaded();
      }
    );

    const unsubShifts = onSnapshot(
      shiftsQuery,
      (snapshot) => {
        setAllShifts(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Shift)));
        shiftsLoaded = true;
        checkAllDataLoaded();
      },
      (error) => {
        console.error('Error fetching user shifts:', error);
        shiftsLoaded = true;
        checkAllDataLoaded();
      }
    );

    return () => {
      unsubAnnouncements();
      unsubShifts();
    };
  }, [user]);

  const unreadAnnouncements = useMemo(() => {
    if (!user || loadingData || announcements.length === 0) return [];
    return announcements.filter((a) => !acknowledgedIds.has(a.id));
  }, [announcements, user, loadingData, acknowledgedIds]);

  const newShifts = useMemo(() => {
    if (!user || loadingData || allShifts.length === 0) return [];

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const pendingShifts = allShifts.filter((shift) => {
      if (shift.status !== 'pending-confirmation') return false;

      const d = getCorrectedLocalDate(shift.date);
      d.setHours(0, 0, 0, 0);

      return d.getTime() >= startOfToday.getTime();
    });

    return pendingShifts.sort(
      (a, b) => getCorrectedLocalDate(a.date).getTime() - getCorrectedLocalDate(b.date).getTime()
    );
  }, [allShifts, user, loadingData]);

  const isLoading = isAuthLoading || isProfileLoading || loadingData;

  useEffect(() => {
    if (!user) return;
    if (gatePending && !loadingData && newShifts.length === 0) {
      router.replace('/dashboard');
    }
  }, [gatePending, loadingData, newShifts.length, user, router]);

  if (isLoading || !user) {
    return (
      <div className="flex min-h-screen w-full flex-col items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  // --- Dialog Rendering Logic ---
  // Priority: 1. New Shifts, 2. Announcements

  if (newShifts.length > 0 && showNewShifts) {
    return (
      <NewShiftsDialog
        user={user}
        shifts={newShifts}
        onClose={() => {
          if (gatePending) return;
          setShowNewShifts(false);
        }}
      />
    );
  }

  // If we're gated, don't show announcements until shifts are handled
  if (!gatePending && unreadAnnouncements.length > 0 && showAnnouncements) {
    return (
      <UnreadAnnouncements
        announcements={unreadAnnouncements}
        user={user}
        onClose={handleAnnouncementsClose}
      />
    );
  }

  return (
    <div className="flex min-h-screen w-full flex-col">
      <Header />
      <main className="flex flex-1 flex-col gap-6 p-4 md:p-8">
        <Dashboard userShifts={allShifts} loading={loadingData} />
      </main>
    </div>
  );
}
