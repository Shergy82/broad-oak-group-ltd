
'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
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

export default function DashboardPage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const { userProfile, loading: isProfileLoading } = useUserProfile();
  const router = useRouter();

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [allShifts, setAllShifts] = useState<Shift[]>([]);
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
    const shiftsQuery = query(collection(db, 'shifts'), where('userId', '==', user.uid));
    
    let announcementsLoaded = false;
    let shiftsLoaded = false;

    const checkAllDataLoaded = () => {
        if (announcementsLoaded && shiftsLoaded) {
            setLoadingData(false);
        }
    }

    const unsubAnnouncements = onSnapshot(announcementsQuery, (snapshot) => {
      setAnnouncements(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Announcement)));
      announcementsLoaded = true;
      checkAllDataLoaded();
    }, (error) => {
        console.error("Error fetching announcements:", error);
        announcementsLoaded = true;
        checkAllDataLoaded();
    });

    const unsubShifts = onSnapshot(shiftsQuery, (snapshot) => {
        setAllShifts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Shift)));
        shiftsLoaded = true;
        checkAllDataLoaded();
    }, (error) => {
        console.error("Error fetching user shifts:", error);
        shiftsLoaded = true;
        checkAllDataLoaded();
    });

    return () => {
      unsubAnnouncements();
      unsubShifts();
    };
  }, [user]);
  
  const unreadAnnouncements = useMemo(() => {
    if (!user || loadingData || announcements.length === 0) return [];
    
    const storedAcknowledged = localStorage.getItem(`acknowledgedAnnouncements_${user.uid}`);
    const acknowledgedIds = new Set(storedAcknowledged ? JSON.parse(storedAcknowledged) : []);

    return announcements.filter(a => !acknowledgedIds.has(a.id));
  }, [announcements, user, loadingData]);

  const newShifts = useMemo(() => {
    if (!user || loadingData || allShifts.length === 0) return [];
    return allShifts.filter(shift => shift.status === 'pending-confirmation');
  }, [allShifts, user, loadingData]);
  
  const activeShifts = useMemo(() => {
    return allShifts.filter(shift => shift.status !== 'completed' && shift.status !== 'incomplete');
  }, [allShifts]);

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
      <main className="flex flex-1 flex-col gap-6 p-4 md:p-8">
        <Dashboard userShifts={allShifts} loading={loadingData} />
      </main>
    </div>
  );
}
