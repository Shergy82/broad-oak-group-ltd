'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { auth, isFirebaseConfigured, db } from '@/lib/firebase';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
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
import { Terminal } from "lucide-react"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const formSchema = z.object({
  signupType: z.enum(['individual', 'company']),
  firstName: z.string().optional(),
  surname: z.string().optional(),
  companyName: z.string().optional(),
  email: z.string().email({ message: 'Please enter a valid email address.' }),
  password: z.string().min(8, { message: 'Password must be at least 8 characters.' }),
  phoneNumber: z.string().min(1, { message: 'Phone number is required.' }),
}).superRefine((data, ctx) => {
    if (data.signupType === 'individual') {
        if (!data.firstName || data.firstName.trim().length < 1) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'First name is required.',
                path: ['firstName'],
            });
        }
        if (!data.surname || data.surname.trim().length < 1) {
             ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Surname is required.',
                path: ['surname'],
            });
        }
    } else if (data.signupType === 'company') {
        if (!data.companyName || data.companyName.trim().length < 1) {
             ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Company name is required.',
                path: ['companyName'],
            });
        }
    }
});


interface SignUpFormProps {
    onSignupSuccess: () => void;
    department?: string;
}

export function SignUpForm({ onSignupSuccess, department }: SignUpFormProps) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signupType, setSignupType] = useState<'individual' | 'company'>('individual');

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      signupType: 'individual',
      firstName: '',
      surname: '',
      companyName: '',
      email: '',
      password: '',
      phoneNumber: '',
    },
  });

  useEffect(() => {
    form.setValue('signupType', signupType);
    // Reset validation when switching types
    form.clearErrors(['firstName', 'surname', 'companyName']);
  }, [signupType, form]);

  async function onSubmit(values: z.infer<typeof formSchema>) {
    if (!auth || !db) return;

    setIsLoading(true);
    setError(null);

    try {
      // Step 1: Create the user in Firebase Authentication
      const userCredential = await createUserWithEmailAndPassword(auth, values.email, values.password);
      const user = userCredential.user;
      
      const fullName = values.signupType === 'individual'
        ? `${values.firstName!.trim().charAt(0).toUpperCase() + values.firstName!.trim().slice(1)} ${values.surname!.trim().charAt(0).toUpperCase() + values.surname!.trim().slice(1)}`
        : values.companyName;

      // Step 2: Update their Auth profile with their full name. 
      await updateProfile(user, { 
        displayName: fullName,
      });

      // Step 3: Determine the user's role.
      const userRole = values.email.toLowerCase() === 'phil.s@broadoakgroup.com' ? 'owner' : 'user';

      // Step 4: Create the user's document in Firestore.
      const userDocRef = doc(db, 'users', user.uid);
      await setDoc(userDocRef, {
          name: fullName,
          email: user.email,
          phoneNumber: values.phoneNumber,
          role: userRole,
          status: 'pending-approval', // New users start as pending
          createdAt: serverTimestamp(),
          operativeId: '', // Add empty operativeId field
          department: department || '',
          baseDepartment: department || '',
          accountType: values.signupType,
      });

      onSignupSuccess();
      toast({
        title: 'Account Pending Approval',
        description: "Your registration is complete. You will be able to log in once an administrator approves your account.",
      });
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
                  errorMessage = "You don't have permission to create an account. Please check your Firestore security rules to allow user creation (e.g., allow create: if request.auth.uid == userId;).";
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

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <Tabs value={signupType} onValueChange={(value) => setSignupType(value as 'individual' | 'company')} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="individual">Individual</TabsTrigger>
                <TabsTrigger value="company">Company</TabsTrigger>
            </TabsList>
        </Tabs>
        
        {error && (
            <Alert variant="destructive">
              <Terminal className="h-4 w-4" />
              <AlertTitle>Sign-up Failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
        )}

        {signupType === 'individual' ? (
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
        ) : (
            <FormField
                control={form.control}
                name="companyName"
                render={({ field }) => (
                    <FormItem>
                        <FormLabel>Company Name</FormLabel>
                        <FormControl>
                            <Input placeholder="Your Company Ltd" {...field} />
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                )}
            />
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
