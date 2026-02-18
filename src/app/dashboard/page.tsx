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
import { useToast } from '@/hooks/use-toast';

export default function DashboardPage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const { userProfile, loading: isProfileLoading } = useUserProfile();
  const router = useRouter();
  const { toast } = useToast();

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [allShifts, setAllShifts] = useState<Shift[]>([]);
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
    if (!user?.uid) {
      setAllShifts([]);
      setAnnouncements([]);
      return;
    }

    const announcementsQuery = query(collection(db, 'announcements'), orderBy('createdAt', 'desc'));
    
    // The query was failing because of the composite index requirement (where + orderBy).
    // The fix is to remove orderBy from the query and sort on the client.
    const shiftsQuery = query(collection(db, 'shifts'), where('userId', '==', user.uid));

    const unsubAnnouncements = onSnapshot(announcementsQuery, (snapshot) => {
      setAnnouncements(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Announcement)));
    });

    const unsubShifts = onSnapshot(shiftsQuery, 
      (snapshot) => {
        const fetchedShifts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Shift));
        // Sort on the client to avoid needing a composite index in Firestore.
        fetchedShifts.sort((a, b) => b.date.toMillis() - a.date.toMillis());
        setAllShifts(fetchedShifts);
      },
      (error) => {
        console.error("Dashboard shifts query failed:", error);
        toast({
          title: "Error loading shifts",
          description: "Could not load your schedule. Please check the console for details and refresh the page.",
          variant: "destructive",
          duration: 10000,
        });
      }
    );

    return () => {
      unsubAnnouncements();
      unsubShifts();
    };
  }, [user?.uid, toast]);


  /* =========================
     MEMOS
  ========================= */

  const unreadAnnouncements = useMemo(() => {
    if (!user) return [];
    return announcements.filter(a => !acknowledgedIds.has(a.id));
  }, [announcements, user, acknowledgedIds]);

  const newShifts = useMemo(() => {
    if (!user) return [];
    return allShifts.filter(shift => shift.status === 'pending-confirmation');
  }, [allShifts, user]);

  const isLoading = isAuthLoading || isProfileLoading;

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
      <Dashboard userShifts={allShifts} loading={isLoading} />
    </div>
  );
}
