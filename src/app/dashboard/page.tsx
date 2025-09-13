
'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useUserProfile } from '@/hooks/use-user-profile';
import Dashboard from '@/components/dashboard/index';
import { Header } from '@/components/layout/header';
import { Spinner } from '@/components/shared/spinner';
import { collection, onSnapshot, query, orderBy, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Announcement, Shift, UserProfile } from '@/types';
import { UnreadAnnouncements } from '@/components/announcements/unread-announcements';
import { NewShiftsDialog } from '@/components/dashboard/new-shifts-dialog';
import { PerformanceAwards } from '@/components/dashboard/performance-awards';

export default function DashboardPage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const { userProfile, loading: isProfileLoading } = useUserProfile();
  const router = useRouter();

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [allShifts, setAllShifts] = useState<Shift[]>([]);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [showAnnouncements, setShowAnnouncements] = useState(true);
  const [showNewShifts, setShowNewShifts] = useState(true);

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

    const announcementsQuery = query(collection(db, 'announcements'), orderBy('createdAt', 'desc'));
    const shiftsQuery = query(collection(db, 'shifts'));
    const usersQuery = query(collection(db, 'users'));
    
    const unsubAnnouncements = onSnapshot(announcementsQuery, (snapshot) => {
      setAnnouncements(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Announcement)));
    }, (error) => console.error("Error fetching announcements:", error));

    const unsubShifts = onSnapshot(shiftsQuery, (snapshot) => {
        setAllShifts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Shift)));
    }, (error) => console.error("Error fetching shifts:", error));

    const unsubUsers = onSnapshot(usersQuery, (snapshot) => {
        setAllUsers(snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile)));
    }, (error) => console.error("Error fetching users:", error));

    // A simple timeout to consider data loaded.
    const timer = setTimeout(() => setLoadingData(false), 2000);

    return () => {
      clearTimeout(timer);
      unsubAnnouncements();
      unsubShifts();
      unsubUsers();
    };
  }, [user]);

  const userShifts = useMemo(() => {
      if (!user) return [];
      return allShifts.filter(shift => shift.userId === user.uid);
  }, [allShifts, user]);

  const unreadAnnouncements = useMemo(() => {
    if (!user || loadingData || announcements.length === 0) return [];
    
    const storedAcknowledged = localStorage.getItem(`acknowledgedAnnouncements_${user.uid}`);
    const acknowledgedIds = new Set(storedAcknowledged ? JSON.parse(storedAcknowledged) : []);

    return announcements.filter(a => !acknowledgedIds.has(a.id));
  }, [announcements, user, loadingData]);

  const newShifts = useMemo(() => {
    if (!user || loadingData || userShifts.length === 0) return [];
    return userShifts.filter(shift => shift.status === 'pending-confirmation');
  }, [userShifts, user, loadingData]);
  
  const isLoading = isAuthLoading || isProfileLoading || loadingData;

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
            shifts={newShifts}
            onClose={() => setShowNewShifts(false)}
        />
    )
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

  return (
    <div className="flex min-h-screen w-full flex-col">
      <Header />
      <main className="flex flex-1 flex-col gap-8 p-4 md:p-8">
        <PerformanceAwards allShifts={allShifts} allUsers={allUsers} />
        <Dashboard allShifts={userShifts} />
      </main>
    </div>
  );
}
