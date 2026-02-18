'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { useAuth } from '@/hooks/use-auth';
import { Spinner } from '@/components/shared/spinner';
import { useUserProfile } from '@/hooks/use-user-profile';

export default function RootPage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const { userProfile, loading: isProfileLoading } = useUserProfile();
  const router = useRouter();

  const isLoading = isAuthLoading || isProfileLoading;

  useEffect(() => {
    if (isLoading) return;

    if (!user) {
      router.replace('/dashboard');
      return;
    }

    if (!userProfile) return;

    const isAdminOrManager = ['admin', 'owner', 'manager'].includes(
      (userProfile.role || '').toLowerCase()
    );

    if (isAdminOrManager) {
      router.replace('/admin/control-panel');
    } else {
      router.replace('/dashboard');
    }
  }, [user, userProfile, isLoading, router]);

  return (
    <div className="flex h-screen w-full items-center justify-center">
      <Spinner size="lg" />
    </div>
  );
}
