'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { doc, setDoc, Timestamp, getDocs, collection, query } from 'firebase/firestore';
import { auth, db, isFirebaseConfigured } from '@/lib/firebase';
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
import { Terminal, CheckCircle } from "lucide-react"
import Link from 'next/link';

const formSchema = z.object({
  firstName: z.string().min(1, { message: 'First name is required.' })
    .transform(name => name.trim().charAt(0).toUpperCase() + name.trim().slice(1)),
  surname: z.string().min(1, { message: 'Surname is required.' })
    .transform(name => name.trim().charAt(0).toUpperCase() + name.trim().slice(1)),
  email: z.string().email({ message: 'Please enter a valid email address.' }),
  password: z.string().min(8, { message: 'Password must be at least 8 characters.' }),
  phoneNumber: z.string().min(1, { message: 'Phone number is required.' }),
});

export function SignUpForm() {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      firstName: '',
      surname: '',
      email: '',
      password: '',
      phoneNumber: '',
    },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    if (!auth || !db) return;

    setIsLoading(true);
    setError(null);
    setSuccess(false);

    try {
      // Check if any user exists. If not, the first user becomes the owner.
      const usersQuery = query(collection(db, 'users'));
      const usersSnapshot = await getDocs(usersQuery);
      const isFirstUser = usersSnapshot.empty;
      
      const userCredential = await createUserWithEmailAndPassword(auth, values.email, values.password);
      const user = userCredential.user;
      
      const fullName = `${values.firstName} ${values.surname}`;

      await updateProfile(user, { displayName: fullName });

      const userRole = isFirstUser ? 'owner' : 'user';
      const userStatus = isFirstUser ? 'active' : 'pending-approval';

      await setDoc(doc(db, 'users', user.uid), {
        name: fullName,
        email: values.email,
        phoneNumber: values.phoneNumber,
        role: userRole,
        status: userStatus,
        createdAt: Timestamp.now(),
      });
      
      setSuccess(true);
      
      // Sign the user out immediately after registration so they can't access the app
      // until they are approved (or if they are the first user/owner).
      await auth.signOut();
      
      form.reset();
      
    } catch (error: any) {
      let errorMessage = 'An unexpected error occurred. Please try again.';
      if (error.code) {
          switch (error.code) {
              case 'auth/email-already-in-use':
                  errorMessage = 'This email is already in use. Please log in or use a different email.';
                  break;
              case 'auth/weak-password':
                  errorMessage = 'The password is too weak. Please choose a stronger password.';
                  break;
              case 'permission-denied':
                  errorMessage = "You don't have permission to create an account. Please check your Firestore security rules to allow user creation (e.g., allow create: if true;).";
                  break;
              default:
                  errorMessage = `Sign-up failed: ${error.message}`;
                  break;
          }
      }
      setError(errorMessage);
      console.error('Signup error:', error);
    } finally {
      setIsLoading(false);
    }
  }

  if (!isFirebaseConfigured || !auth) {
    return <UnconfiguredForm />;
  }

  if (success) {
      return (
        <>
            <Alert className="border-green-500 text-green-700 [&>svg]:text-green-500">
                <CheckCircle className="h-4 w-4" />
                <AlertTitle>Account Created</AlertTitle>
                <AlertDescription>
                    Your account has been created and is now awaiting administrator approval. You will be able to log in once your account has been activated.
                </AlertDescription>
            </Alert>
             <p className="mt-6 text-center text-sm text-muted-foreground">
                <Link href="/login" className="font-semibold text-primary hover:underline">
                    Back to Log in
                </Link>
            </p>
        </>
      )
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        {error && (
            <Alert variant="destructive">
              <Terminal className="h-4 w-4" />
              <AlertTitle>Sign-up Failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="firstName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>First Name</FormLabel>
                  <FormControl>
                    <Input placeholder="John" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="surname"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Surname</FormLabel>
                  <FormControl>
                    <Input placeholder="Doe" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
        </div>
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
              <FormLabel>Password</FormLabel>
              <FormControl>
                <Input type="password" placeholder="••••••••" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
            control={form.control}
            name="phoneNumber"
            render={({ field }) => (
                <FormItem>
                    <FormLabel>Phone Number</FormLabel>
                    <FormControl>
                        <Input placeholder="123-456-7890" {...field} />
                    </FormControl>
                    <FormMessage />
                </FormItem>
            )}
        />
        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading ? <Spinner /> : 'Create Account'}
        </Button>
      </form>
    </Form>
  );
}
