
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUserProfile } from '@/hooks/use-user-profile';
import { Header } from '@/components/layout/header';
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
      <div className="flex min-h-screen w-full flex-col items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  // If we are still loading, or the user is not present, don't render anything yet.
  // The useEffect above will handle the redirect.
  if (!userProfile) {
    return (
        <div className="flex min-h-screen w-full flex-col items-center justify-center">
            <Spinner size="lg" />
        </div>
    );
  }

  // This is the key guard. It must allow 'admin', 'owner', and 'manager'.
  if (!['admin', 'owner', 'manager'].includes(userProfile.role)) {
    return (
      <div className="flex min-h-screen w-full flex-col">
        <Header />
        <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
            <Alert variant="destructive">
                <Terminal className="h-4 w-4" />
                <AlertTitle>Access Denied</AlertTitle>
                <AlertDescription>
                    You do not have permission to view this page. Access is restricted to Admins, Owners, and Managers.
                </AlertDescription>
            </Alert>
        </main>
      </div>
    );
  }

  // If the user is an admin, owner, or manager, render the page content.
  return (
    <div className="flex min-h-screen w-full flex-col">
      <Header />
      <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
        {children}
      </main>
    </div>
  );
}
