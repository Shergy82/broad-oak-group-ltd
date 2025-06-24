'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useUserProfile } from '@/hooks/use-user-profile';
import Dashboard from '@/components/dashboard/index';
import { ShiftScheduleOverview } from '@/components/admin/shift-schedule-overview';
import { Header } from '@/components/layout/header';
import { Spinner } from '@/components/shared/spinner';

export default function Home() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const { userProfile, loading: isProfileLoading } = useUserProfile();
  const router = useRouter();

  useEffect(() => {
    if (!isAuthLoading && !user) {
      router.push('/login');
    }
  }, [user, isAuthLoading, router]);

  const isLoading = isAuthLoading || isProfileLoading;

  if (isLoading || !user) {
    return (
      <div className="flex min-h-screen w-full flex-col items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  const isPrivilegedUser = userProfile && ['admin', 'owner'].includes(userProfile.role);

  return (
    <div className="flex min-h-screen w-full flex-col">
      <Header />
      <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
        {isPrivilegedUser ? <ShiftScheduleOverview /> : <Dashboard />}
      </main>
    </div>
  );
}
