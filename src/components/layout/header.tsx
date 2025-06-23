'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/hooks/use-auth';
import { useUserProfile } from '@/hooks/use-user-profile';
import { Logo } from '../shared/logo';
import { Button } from '@/components/ui/button';
import { LogOut, Shield } from 'lucide-react';

export function Header() {
  const { user } = useAuth();
  const { userProfile } = useUserProfile();
  const router = useRouter();

  const handleSignOut = async () => {
    if (auth) {
      await signOut(auth);
      router.push('/login');
    }
  };

  const isPrivilegedUser = userProfile && ['admin', 'owner'].includes(userProfile.role);

  return (
    <header className="sticky top-0 flex h-16 items-center gap-4 border-b bg-background/80 backdrop-blur-sm px-4 md:px-6 z-50">
      <Logo />
      <div className="flex w-full items-center justify-end gap-4">
        {user && (
          <>
            {isPrivilegedUser && (
              <Button variant="outline" asChild>
                <Link href="/admin">
                  <Shield className="mr-2 h-4 w-4" />
                  Admin Panel
                </Link>
              </Button>
            )}
            <Button variant="ghost" onClick={handleSignOut}>
              <LogOut className="mr-2 h-4 w-4" />
              Logout
            </Button>
          </>
        )}
      </div>
    </header>
  );
}
