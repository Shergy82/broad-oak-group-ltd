
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { useAuth } from '@/hooks/use-auth';
import { useUserProfile } from '@/hooks/use-user-profile';
import { HealthAndSafetyFileList } from '@/components/health-and-safety/file-list';

export default function HealthAndSafetyPage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const { userProfile, loading: isProfileLoading } = useUserProfile();
  const router = useRouter();

  useEffect(() => {
    if (!isAuthLoading && !user) router.replace('/dashboard');
  }, [user, isAuthLoading, router]);

  if (!user) return null;
  if (isProfileLoading || !userProfile) return null;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold">Health & Safety</h1>
      <HealthAndSafetyFileList userProfile={userProfile} />
    </div>
  );
}

