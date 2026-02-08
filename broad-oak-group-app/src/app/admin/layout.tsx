
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUserProfile } from '@/hooks/use-user-profile';
import { Spinner } from '@/components/shared/spinner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Terminal } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, isLoading: isAuthLoading } = useAuth();
  const { userProfile, loading: isProfileLoading } = useUserProfile();
  const router = useRouter();

  const loading = isAuthLoading || isProfileLoading;

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center">
        <Spinner size="lg" />
      </main>
    );
  }

  // If we are still loading, or the user is not present, don't render anything yet.
  // The useEffect above will handle the redirect.
  if (!userProfile) {
    return (
        <main className="flex flex-1 flex-col items-center justify-center">
            <Spinner size="lg" />
        </main>
    );
  }

  // This is the key guard. It must allow both 'admin' and 'owner'.
  if (!['admin', 'owner'].includes(userProfile.role)) {
    return (
      <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
          <Alert variant="destructive">
              <Terminal className="h-4 w-4" />
              <AlertTitle>Access Denied</AlertTitle>
              <AlertDescription>
                  You do not have permission to view this page. Access is restricted to Admins and the Owner.
              </AlertDescription>
          </Alert>
      </main>
    );
  }

  // If the user is an admin or owner, render the page content.
  return (
    <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
      {children}
    </main>
  );
}
