'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { useAuth } from '@/hooks/use-auth';
import { useUserProfile } from '@/hooks/use-user-profile';
import { HealthAndSafetyFileList } from '@/components/health-and-safety/file-list';
import { Spinner } from '@/components/shared/spinner';

export default function HealthAndSafetyPage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const { userProfile, loading: isProfileLoading } = useUserProfile();
  const router = useRouter();

  useEffect(() => {
    if (!isAuthLoading && !user) router.replace('/dashboard');
  }, [user, isAuthLoading, router]);

  if (isAuthLoading || isProfileLoading || !userProfile) {
    return (
        <div className="p-6 flex items-center justify-center h-64">
            <Spinner size="lg"/>
        </div>
    )
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Health & Safety</h1>
        <p className="text-muted-foreground mt-1">
          Centrally stored health and safety documents for all team members to access.
        </p>
      </div>

      <HealthAndSafetyFileList userProfile={userProfile} />
    </div>
  );
}
