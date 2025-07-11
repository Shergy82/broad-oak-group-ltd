'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth, isFirebaseConfigured } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { Spinner } from '@/components/shared/spinner';
import { Logo } from '@/components/shared/logo';
import Link from 'next/link';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Terminal, MailCheck } from "lucide-react"

const formSchema = z.object({
  email: z.string().email({ message: 'Please enter a valid email address.' }),
});

export default function ForgotPasswordPage() {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: '',
    },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    if (!auth) return;

    setIsLoading(true);
    setError(null);
    try {
      await sendPasswordResetEmail(auth, values.email);
      setIsSubmitted(true);
    } catch (error: any) {
      let errorMessage = 'An unexpected error occurred. Please try again.';
       if (error.code) {
        switch (error.code) {
          case 'auth/user-not-found':
            // We don't want to reveal if a user exists, so we'll show a generic success message.
            setIsSubmitted(true);
            break;
          default:
            errorMessage = `Request failed: ${error.message}`;
            break;
        }
      }
      if (errorMessage !== 'An unexpected error occurred. Please try again.') {
          setError(errorMessage);
      }
      console.error('Password reset error:', error);
    } finally {
      setIsLoading(false);
    }
  }
  
  if (!isFirebaseConfigured || !auth) {
    return (
        <div className="flex min-h-screen flex-col items-center justify-center p-4">
            <Card className="w-full max-w-md">
                <CardHeader><CardTitle>Service Unavailable</CardTitle></CardHeader>
                <CardContent>
                    <Alert variant="destructive">
                      <Terminal className="h-4 w-4" />
                      <AlertTitle>Firebase Not Configured</AlertTitle>
                      <AlertDescription>
                        Authentication features are currently unavailable.
                      </AlertDescription>
                    </Alert>
                </CardContent>
            </Card>
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
          <CardHeader>
            <CardTitle>Forgot Password</CardTitle>
            <CardDescription>
              {isSubmitted 
                ? "Check your inbox for the next steps." 
                : "Enter your email and we'll send you a link to reset your password."
              }
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isSubmitted ? (
                 <div className="flex flex-col items-center justify-center space-y-4 text-center">
                    <MailCheck className="h-16 w-16 text-green-500" />
                    <p className="text-muted-foreground">
                        If an account with that email exists, a password reset link has been sent. Please check your spam folder if you don't see it.
                    </p>
                </div>
            ) : (
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                  {error && (
                      <Alert variant="destructive">
                        <Terminal className="h-4 w-4" />
                        <AlertTitle>Request Failed</AlertTitle>
                        <AlertDescription>{error}</AlertDescription>
                      </Alert>
                  )}
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input placeholder="name@example.com" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" className="w-full" disabled={isLoading}>
                    {isLoading ? <Spinner /> : 'Send Reset Email'}
                  </Button>
                </form>
              </Form>
            )}
          </CardContent>
        </Card>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Remember your password?{' '}
          <Link href="/login" className="font-semibold text-primary hover:underline">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}