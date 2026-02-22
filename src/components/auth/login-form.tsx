'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth, isFirebaseConfigured, db } from '@/lib/firebase';
import {
  collection,
  getDocs,
  limit,
  query,
  updateDoc,
  where,
} from 'firebase/firestore';

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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Terminal } from 'lucide-react';
import Link from 'next/link';

const formSchema = z.object({
  email: z.string().email({ message: 'Please enter a valid email address.' }),
  password: z.string().min(1, { message: 'Password is required.' }),
});

interface LoginFormProps {
    onLoginStatusChange: (status: 'form' | 'suspended' | 'pending') => void;
}

export function LoginForm({ onLoginStatusChange }: LoginFormProps) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: '', password: '' },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsLoading(true);
    setError(null);
    if (!auth || !db) return;

    try {
      // 1) Firebase Auth sign-in
      const userCredential = await signInWithEmailAndPassword(
        auth,
        values.email,
        values.password
      );
      const authUser = userCredential.user;

      // 2) Find the Firestore user doc by email
      const usersCol = collection(db, 'users');
      const q = query(
        usersCol,
        where('email', '==', values.email.trim().toLowerCase()),
        limit(1)
      );
      const snap = await getDocs(q);

      if (snap.empty) {
        await auth.signOut();
        setError('No user profile found for this account. Please contact an administrator.');
        setIsLoading(false);
        return;
      }

      const userDocSnap = snap.docs[0];
      const userProfile = userDocSnap.data() as any;

      // 3) Status enforcement
      if (userProfile.status === 'suspended') {
        await auth.signOut();
        setIsLoading(false);
        onLoginStatusChange('suspended');
        return;
      }

      if (userProfile.status === 'pending-approval') {
        onLoginStatusChange('pending');
        // The UserProfileProvider will redirect the now-logged-in user.
        // We just need to stop execution here to prevent the success toast.
        return;
      }

      // 4) Link Auth UID <-> Firestore user doc
      await updateDoc(userDocSnap.ref, {
        authUid: authUser.uid,
        fireAuthUid: authUser.uid,
        authLinkedAt: new Date(),
      });

      toast({
        title: 'Login Successful',
        description: 'Welcome back!',
      });

      // Redirect handled by AuthProvider in parent
    } catch (err: any) {
      let errorMessage = 'An unexpected error occurred. Please try again.';

      if (err?.code) {
        switch (err.code) {
          case 'auth/invalid-credential':
            errorMessage = 'Invalid email or password. Please try again.';
            break;
          case 'auth/user-disabled':
            errorMessage =
              'This account has been disabled or suspended. Please contact an administrator.';
            break;
          case 'auth/too-many-requests':
            errorMessage = 'Too many login attempts. Please try again later.';
            break;
          default:
            errorMessage = `Login failed: ${err.message}`;
            break;
        }
      }

      setError(errorMessage);
      console.error('Login error:', err);
    } finally {
      setIsLoading(false);
    }
  }

  if (!isFirebaseConfigured || !auth) {
    return <UnconfiguredForm />;
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <Terminal className="h-4 w-4" />
            <AlertTitle>Login Failed</AlertTitle>
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

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-center justify-between">
                <FormLabel>Password</FormLabel>
                <Link
                  href="/forgot-password"
                  className="text-sm font-medium text-primary hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
              <FormControl>
                <Input type="password" placeholder="••••••••" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="pt-2">
          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? <Spinner /> : 'Log In'}
          </Button>
        </div>
      </form>
    </Form>
  );
}
