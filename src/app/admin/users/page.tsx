'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { useAuth } from '@/hooks/use-auth';
import { useUserProfile } from '@/hooks/use-user-profile';
import { UserManagement } from '@/components/admin/user-management';

export default function UsersPage() {
  const router = useRouter();
  const { user, isLoading: isAuthLoading } = useAuth();
  const { userProfile, loading: isProfileLoading } = useUserProfile();

  useEffect(() => {
    if (!isAuthLoading && !user) router.replace('/login');
  }, [user, isAuthLoading, router]);

  if (!user) return null;
  if (isProfileLoading || !userProfile) return null;

  if (userProfile.role !== 'admin') {
    router.replace('/dashboard');
    return null;
  }

  return <UserManagement />;
}
