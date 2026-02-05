'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { useAuth } from '@/hooks/use-auth';
import { useUserProfile } from '@/hooks/use-user-profile';
import { Spinner } from '@/components/shared/spinner';
import { ShiftImporter } from '@/components/admin/shift-importer';

export default function ControlPanelPage() {
  const router = useRouter();
  const { user, isLoading: isAuthLoading } = useAuth();
  const { userProfile, loading: isProfileLoading } = useUserProfile();

  useEffect(() => {
    if (!isAuthLoading && !user) {
      router.replace('/login');
    }
  }, [user, isAuthLoading, router]);

  if (!user || isAuthLoading || isProfileLoading || !userProfile) {
    return (
      <div className="p-6 flex justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <h1 className="text-2xl font-semibold">Admin Control Panel</h1>

      {/* Shift Import UI */}
      <ShiftImporter userProfile={userProfile} />
    </div>
  );
}
