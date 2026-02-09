'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

import { useAuth } from '@/hooks/use-auth';
import { LoginForm } from '@/components/auth/login-form';
import { Logo } from '@/components/shared/logo';
import { Spinner } from '@/components/shared/spinner';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';

import { Button } from '@/components/ui/button';

import { Terminal, CheckCircle } from 'lucide-react';

export default function LoginPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  const [loginStatus, setLoginStatus] = useState<
    'form' | 'suspended' | 'pending'
  >('form');

  useEffect(() => {
    if (!isLoading && user) {
      router.push('/dashboard');
    }
  }, [user, isLoading, router]);

  if (isLoading || user) {
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

        <Card className="shadow-lg">
          {loginStatus === 'form' && (
            <>
              <CardHeader>
                <CardTitle>Welcome Back</CardTitle>
                <CardDescription>
                  Enter your email and password to access your account.
                </CardDescription>
              </CardHeader>

              <CardContent>
                <LoginForm onLoginStatusChange={setLoginStatus} />
              </CardContent>
            </>
          )}

          {loginStatus === 'suspended' && (
            <>
              <CardHeader>
                <CardTitle>Account Suspended</CardTitle>
              </CardHeader>

              <CardContent>
                <Alert variant="destructive">
                  <Terminal className="h-4 w-4" />
                  <AlertTitle>Access Denied</AlertTitle>
                  <AlertDescription>
                    Your account has been suspended. Please contact an
                    administrator for assistance.
                  </AlertDescription>
                </Alert>

                <Button
                  onClick={() => setLoginStatus('form')}
                  className="mt-4 w-full"
                >
                  Back to Login
                </Button>
              </CardContent>
            </>
          )}

          {loginStatus === 'pending' && (
            <>
              <CardHeader>
                <CardTitle>Account Pending Approval</CardTitle>
              </CardHeader>

              <CardContent>
                <Alert>
                  <CheckCircle className="h-4 w-4" />
                  <AlertTitle>Please Wait</AlertTitle>
                  <AlertDescription>
                    Your account is pending approval. You will be able to log in
                    once an administrator approves your account.
                  </AlertDescription>
                </Alert>

                <Button
                  onClick={() => setLoginStatus('form')}
                  className="mt-4 w-full"
                >
                  Back to Login
                </Button>
              </CardContent>
            </>
          )}
        </Card>

        {loginStatus === 'form' && (
          <p className="mt-6 text-center text-sm text-muted-foreground">
            Don&apos;t have an account?{' '}
            <Link
              href="/signup"
              className="font-semibold text-primary hover:underline"
            >
              Sign up
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
