
'use client';

import { AvailabilityOverview } from '@/components/admin/availability-overview';
import { ShiftImporter } from '@/components/admin/shift-importer';
import { useUserProfile } from '@/hooks/use-user-profile';
import { Spinner } from '@/components/shared/spinner';
import { YesterdayReportGenerator } from '@/components/admin/yesterday-report-generator';
import { RoleKpiDashboard } from '@/components/admin/role-kpi-dashboard';
import { useAllUsers } from '@/hooks/use-all-users';
import { useEffect, useState } from 'react';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Shift } from '@/types';
import { ContractStatsDashboard } from '@/components/admin/contract-stats-dashboard';

export default function ControlPanelPage() {
  const { userProfile, loading: profileLoading } = useUserProfile();
  const { users, loading: usersLoading, error: usersError } = useAllUsers();
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [shiftsLoading, setShiftsLoading] = useState(true);
  const [shiftsError, setShiftsError] = useState<string | null>(null);

  useEffect(() => {
    if (!db) {
      setShiftsLoading(false);
      setShiftsError("Firebase is not configured.");
      return;
    }
    const shiftsQuery = query(collection(db, 'shifts'));
    const unsubscribe = onSnapshot(shiftsQuery, 
      (snapshot) => {
        setShifts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Shift)));
        setShiftsLoading(false);
      },
      (err) => {
        console.error("Error fetching shifts:", err);
        setShiftsError("Could not fetch shift data.");
        setShiftsLoading(false);
      }
    );
    return () => unsubscribe();
  }, []);

  const loading = profileLoading || usersLoading || shiftsLoading;

  if (loading) {
    return (
      <div className="flex h-48 w-full items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!userProfile) {
    return null; // or some other placeholder
  }

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <AvailabilityOverview />
        <YesterdayReportGenerator />
      </div>
      <ShiftImporter userProfile={userProfile} />
      <ContractStatsDashboard />
      <RoleKpiDashboard allShifts={shifts} allUsers={users} />
    </div>
  );
}
