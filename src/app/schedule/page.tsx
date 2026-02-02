'use client';

import { useEffect, useState } from 'react';
import { ShiftScheduleOverview } from '@/components/admin/shift-schedule-overview';
import { useAuth } from '@/hooks/use-auth';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { Spinner } from '@/components/shared/spinner';
import type { UserProfile } from '@/types';

export default function TeamSchedulePage() {
  const { user, isLoading } = useAuth();

  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadProfile() {
      if (!user || !db) {
        setUserProfile(null);
        setProfileLoading(false);
        return;
      }

      setProfileLoading(true);
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (cancelled) return;
        setUserProfile(snap.exists() ? (snap.data() as UserProfile) : null);
      } catch {
        if (cancelled) return;
        setUserProfile(null);
      } finally {
        if (!cancelled) setProfileLoading(false);
      }
    }

    loadProfile();
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (isLoading || profileLoading) {
    return (
      <div className="p-6">
        <Spinner />
      </div>
    );
  }

  if (!user) {
    return <div className="p-6">Please sign in to view the schedule.</div>;
  }

  if (!userProfile) {
    return <div className="p-6">Your profile could not be loaded.</div>;
  }

  return <ShiftScheduleOverview userProfile={userProfile} />;
}
