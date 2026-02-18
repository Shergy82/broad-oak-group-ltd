'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useUserProfile } from '@/hooks/use-user-profile';
import Dashboard from '@/components/dashboard';
import { Spinner } from '@/components/shared/spinner';
import { collection, onSnapshot, query, orderBy, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Announcement, Shift } from '@/types';
import { UnreadAnnouncements } from '@/components/announcements/unread-announcements';
import { NewShiftsDialog } from '@/components/dashboard/new-shifts-dialog';

export default function DashboardPage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const { userProfile, loading: isProfileLoading } = useUserProfile();
  const router = useRouter();

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [allShifts, setAllShifts] = useState<Shift[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [showAnnouncements, setShowAnnouncements] = useState(true);
  const [showNewShifts, setShowNewShifts] = useState(true);
  const [acknowledgedIds, setAcknowledgedIds] = useState<Set<string>>(new Set());

  /* =========================
     AUTH REDIRECT
  ========================= */

  useEffect(() => {
    if (!isAuthLoading && !user) {
      router.push('/login');
    }
  }, [user, isAuthLoading, router]);

  /* =========================
     LOAD ACKNOWLEDGED ANNOUNCEMENTS
  ========================= */

  useEffect(() => {
    if (!user) return;

    try {
      const stored = localStorage.getItem(`acknowledgedAnnouncements_${user.uid}`);
      if (stored) {
        setAcknowledgedIds(new Set(JSON.parse(stored)));
      }
    } catch {
      setAcknowledgedIds(new Set());
    }
  }, [user]);

  /* =========================
     FIRESTORE LISTENERS
  ========================= */

  useEffect(() => {
    if (!user || !userProfile) {
      setLoadingData(false);
      return;
    }

    setLoadingData(true);

    const announcementsQuery = query(
      collection(db, 'announcements'),
      orderBy('createdAt', 'desc')
    );

    const shiftsQuery = query(
      collection(db, 'shifts'),
      where('userId', '==', userProfile.uid)
    );

    let announcementsLoaded = false;
    let shiftsLoaded = false;

    const checkLoaded = () => {
      if (announcementsLoaded && shiftsLoaded) {
        setLoadingData(false);
      }
    };

    const unsubAnnouncements = onSnapshot(
      announcementsQuery,
      (snapshot) => {
        setAnnouncements(
          snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Announcement))
        );
        announcementsLoaded = true;
        checkLoaded();
      },
      () => {
        announcementsLoaded = true;
        checkLoaded();
      }
    );

    const unsubShifts = onSnapshot(
      shiftsQuery,
      (snapshot) => {
        setAllShifts(
          snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Shift))
        );
        shiftsLoaded = true;
        checkLoaded();
      },
      () => {
        shiftsLoaded = true;
        checkLoaded();
      }
    );

    return () => {
      unsubAnnouncements();
      unsubShifts();
    };
  }, [user, userProfile]);

  /* =========================
     MEMOS
  ========================= */

  const unreadAnnouncements = useMemo(() => {
    if (!user || loadingData) return [];
    return announcements.filter(a => !acknowledgedIds.has(a.id));
  }, [announcements, user, loadingData, acknowledgedIds]);

  const newShifts = useMemo(() => {
    if (!user || loadingData) return [];
    return allShifts.filter(shift => shift.status === 'pending-confirmation');
  }, [allShifts, user, loadingData]);

  const isLoading = isAuthLoading || isProfileLoading || loadingData;

  /* =========================
     LOADING + DIALOG PRIORITY
  ========================= */

  if (isLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (newShifts.length > 0 && showNewShifts) {
    return (
      <NewShiftsDialog
        shifts={newShifts}
        onClose={() => setShowNewShifts(false)}
      />
    );
  }

  if (unreadAnnouncements.length > 0 && showAnnouncements) {
    return (
      <UnreadAnnouncements
        announcements={unreadAnnouncements}
        user={user}
        onClose={() => setShowAnnouncements(false)}
      />
    );
  }

  /* =========================
     MAIN DASHBOARD
  ========================= */

  return (
    <div className="space-y-8 p-6">
      <Dashboard userShifts={allShifts} loading={loadingData} />
    </div>
  );
}
