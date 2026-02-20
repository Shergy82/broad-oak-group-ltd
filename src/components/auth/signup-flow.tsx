'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { SignUpForm } from '@/components/auth/signup-form';
import { Logo } from '@/components/shared/logo';
import Link from 'next/link';
import { Spinner } from '@/components/shared/spinner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { CheckCircle } from 'lucide-react';


export function SignUpFlow() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isSuccess, setIsSuccess] = useState(false);
  const department = searchParams.get('department');

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
          {isSuccess ? (
            <>
                <CardHeader>
                    <CardTitle>Registration Complete</CardTitle>
                </CardHeader>
                <CardContent>
                    <Alert className="border-green-500 text-green-700 [&>svg]:text-green-500">
                        <CheckCircle className="h-4 w-4" />
                        <AlertTitle>Success!</AlertTitle>
                        <AlertDescription>
                            <p>Your account is now pending approval from an administrator. You will receive a notification once your account is active.</p>
                            <p className="mt-4">You can now return to the <Link href="/login" className="font-semibold underline">login page</Link>.</p>
                        </AlertDescription>
                    </Alert>
                </CardContent>
            </>
          ) : (
            <>
              <CardHeader>
                <CardTitle>Create an Account</CardTitle>
                <CardDescription>
                    {department 
                        ? `You are joining the ${department} department.`
                        : "Enter your details below to get started."
                    }
                </CardDescription>
              </CardHeader>
              <CardContent>
                <SignUpForm onSignupSuccess={() => setIsSuccess(true)} department={department || undefined} />
              </CardContent>
            </>
          )}
        </Card>
        {!isSuccess && (
          <p className="mt-6 text-center text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link href="/login" className="font-semibold text-primary hover:underline">
              Log in
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
