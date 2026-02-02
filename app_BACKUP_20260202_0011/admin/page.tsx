
'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUserProfile } from '@/hooks/use-user-profile';

export default function AdminPageRedirect() {
  const router = useRouter();
  const { userProfile, loading } = useUserProfile();

  useEffect(() => {
    if (!loading && userProfile) {
      router.replace('/admin/home');
    }
  }, [userProfile, loading, router]);

  return null;
}
