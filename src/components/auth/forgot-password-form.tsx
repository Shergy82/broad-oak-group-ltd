'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth, isFirebaseConfigured } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { Spinner } from '@/components/shared/spinner';
import { UnconfiguredForm } from '@/components/auth/unconfigured-form';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Terminal, CheckCircle, Mail } from "lucide-react"

const formSchema = z.object({
  email: z.string().email({ message: 'Please enter a valid email address.' }),
});

export function ForgotPasswordForm() {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [sentEmail, setSentEmail] = useState('');

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
    setSuccess(false);
    
    const email = values.email.trim().toLowerCase();

    try {
      await sendPasswordResetEmail(auth, email);
      setSentEmail(email);
      setSuccess(true);
      form.reset();
      toast({
        title: "Email Sent",
        description: `A reset link has been sent to ${email}`,
      });
    } catch (err: any) {
      console.error('Password reset error:', err);
      let errorMessage = 'An unexpected error occurred. Please try again.';
      
      if (err.code) {
        switch (err.code) {
          case 'auth/user-not-found':
            // For security, Firebase sometimes doesn't throw this anymore, 
            // but we keep it for projects with enumeration protection disabled.
            errorMessage = 'No account found with this email address.';
            break;
          case 'auth/invalid-email':
            errorMessage = 'The email address is not valid.';
            break;
          case 'auth/too-many-requests':
             errorMessage = 'Too many requests. Please try again later.';
            break;
          case 'auth/network-request-failed':
            errorMessage = 'Network error. Please check your internet connection.';
            break;
          default:
            errorMessage = err.message || 'Failed to send reset email.';
            break;
        }
      }
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }

  if (!isFirebaseConfigured || !auth) {
    return <UnconfiguredForm />;
  }
  
  if (success) {
    return (
        <div className="space-y-4">
            <Alert className="border-green-500 text-green-700 [&>svg]:text-green-500 bg-green-50">
                <CheckCircle className="h-4 w-4" />
                <AlertTitle>Check Your Email</AlertTitle>
                <AlertDescription>
                    A password reset link has been sent to <strong>{sentEmail}</strong>. 
                    Please check your inbox and your spam folder.
                </AlertDescription>
            </Alert>
            <Button 
              variant="outline" 
              className="w-full" 
              onClick={() => setSuccess(false)}
            >
              Try another email
            </Button>
        </div>
    )
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
              <FormLabel>Email Address</FormLabel>
              <FormControl>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input 
                    placeholder="name@example.com" 
                    className="pl-10" 
                    {...field} 
                    disabled={isLoading}
                  />
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="pt-2">
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? <Spinner /> : 'Send Reset Link'}
            </Button>
        </div>
      </form>
    </Form>
  );
}
