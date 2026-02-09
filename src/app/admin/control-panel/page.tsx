'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { useAuth } from '@/hooks/use-auth';
import { Spinner } from '@/components/shared/spinner';
import { CustomizableDashboard } from '@/components/admin/customizable-dashboard';

export default function ControlPanelPage() {
  const router = useRouter();
  const { user, isLoading: isAuthLoading } = useAuth();
  
  useEffect(() => {
    if (!isAuthLoading && !user) {
      router.replace('/login');
    }
  }, [user, isAuthLoading, router]);

  if (isAuthLoading || !user) {
    return (
      <div className="p-6 flex justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <CustomizableDashboard />
    </div>
  );
}
