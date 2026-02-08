'use client';

import { useRouter } from 'next/navigation';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/hooks/use-auth';
import { useUserProfile } from '@/hooks/use-user-profile';
import { Logo } from '../shared/logo';
import { Button } from '@/components/ui/button';
import {
  Briefcase,
  Calendar,
  HardHat,
  LogOut,
  Megaphone,
  Shield,
  User,
  UserCog,
  Users,
  TrendingUp,
  HelpCircle,
  Fingerprint,
  Building2,
  ListChecks,
} from 'lucide-react';
import { NotificationButton } from '../shared/notification-button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

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

  const isPrivilegedUser = userProfile && ['admin', 'owner', 'manager'].includes(userProfile.role);

  const getInitials = (name?: string) => {
    if (!name) return <User className="h-5 w-5" />;
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase();
  };

  return (
    <header className="sticky top-0 flex h-16 items-center gap-4 border-b bg-background/80 backdrop-blur-sm px-4 md:px-6 z-50">
      <Logo />
      <div className="flex w-full items-center justify-end gap-2 md:gap-4">
        {user && (
          <>
            <NotificationButton />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="icon" className="rounded-full">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback>{getInitials(userProfile?.name)}</AvatarFallback>
                  </Avatar>
                  <span className="sr-only">Toggle user menu</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {userProfile?.name && <DropdownMenuLabel>{userProfile.name}</DropdownMenuLabel>}
                {userProfile?.email && (
                  <DropdownMenuLabel className="font-normal text-muted-foreground -mt-2 pb-2">
                    {userProfile.email}
                  </DropdownMenuLabel>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => router.push('/dashboard')} className="cursor-pointer">
                  <Calendar className="mr-2" />
                  <span>Dashboard</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push('/site-schedule')} className="cursor-pointer">
                  <Building2 className="mr-2" />
                  <span>Site Schedule</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    window.open('https://studio--studio-6303842196-5daf6.us-central1.hosted.app', '_blank')
                  }
                  className="cursor-pointer"
                >
                  <Fingerprint className="mr-2" />
                  <span>Digital Sign In/Out</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push('/announcements')} className="cursor-pointer">
                  <Megaphone className="mr-2" />
                  <span>Announcements</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push('/stats')} className="cursor-pointer">
                  <TrendingUp className="mr-2" />
                  <span>Stats</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push('/projects')} className="cursor-pointer">
                  <Briefcase className="mr-2" />
                  <span>Projects</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push('/health-and-safety')} className="cursor-pointer">
                  <HardHat className="mr-2" />
                  <span>Health & Safety</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push('/help')} className="cursor-pointer">
                  <HelpCircle className="mr-2" />
                  <span>Help & Support</span>
                </DropdownMenuItem>
                {isPrivilegedUser && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Admin Area</DropdownMenuLabel>
                    <DropdownMenuItem onClick={() => router.push('/admin')} className="cursor-pointer">
                      <Shield className="mr-2" />
                      <span>Control Panel</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => router.push('/schedule')} className="cursor-pointer">
                      <Users className="mr-2" />
                      <span>Team Schedule</span>
                    </DropdownMenuItem>
                     <DropdownMenuItem onClick={() => router.push('/admin/availability')} className="cursor-pointer">
                      <Calendar className="mr-2" />
                      <span>Availability</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => router.push('/admin/contracts')} className="cursor-pointer">
                      <Briefcase className="mr-2" />
                      <span>Contracts</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => router.push('/admin/performance')}
                      className="cursor-pointer"
                    >
                      <TrendingUp className="mr-2" />
                      <span>Performance</span>
                    </DropdownMenuItem>
                     <DropdownMenuItem onClick={() => router.push('/admin/tasks')} className="cursor-pointer">
                      <ListChecks className="mr-2" />
                      <span>Tasks</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => router.push('/admin/users')} className="cursor-pointer">
                      <UserCog className="mr-2" />
                      <span>User Management</span>
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut} className="cursor-pointer">
                  <LogOut className="mr-2" />
                  <span>Logout</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>
    </header>
  );
}
