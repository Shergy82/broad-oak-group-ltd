'use client';

import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { CheckCircle, LogOut } from 'lucide-react';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import { Logo } from '@/components/shared/logo';
import { Spinner } from '@/components/shared/spinner';
import { useEffect } from 'react';
import { useUserProfile } from '@/hooks/use-user-profile';

export default function PendingApprovalPage() {
  const { user, isLoading: authLoading } = useAuth();
  const { userProfile, loading: profileLoading } = useUserProfile();
  const router = useRouter();

  const handleLogout = async () => {
    if (auth) {
      await signOut(auth);
      router.push('/login');
    }
  };
  
  useEffect(() => {
      if (!authLoading && !user) {
          router.replace('/login');
      }
      if (!profileLoading && userProfile && userProfile.status !== 'pending-approval') {
          router.replace('/dashboard');
      }
  }, [user, authLoading, userProfile, profileLoading, router]);

  if (authLoading || profileLoading) {
      return (
           <div className="flex min-h-screen w-full flex-col items-center justify-center">
                <Spinner size="lg" />
            </div>
      )
  }

  if (!userProfile) {
    // This can happen briefly or if the user doc is deleted while they are logged in.
    // Logging them out is a safe default.
    handleLogout();
    return (
        <div className="flex min-h-screen w-full flex-col items-center justify-center">
            <Spinner size="lg" />
        </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Account Pending Approval</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              <CheckCircle className="h-4 w-4" />
              <AlertTitle>Please Wait</AlertTitle>
              <AlertDescription>
                Your account is pending approval. You will be able to access the
                app once an administrator approves your account.
              </AlertDescription>
            </Alert>
            <Button onClick={handleLogout} variant="outline" className="w-full">
              <LogOut className="mr-2 h-4 w-4" />
              Logout
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
