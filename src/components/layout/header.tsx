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
  FileArchive,
  Wand2,
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
import { GlobalShiftImporter } from '@/components/admin/global-shift-importer';

export function Header() {
  const { user } = useAuth();
  const { userProfile } = useUserProfile();
  const router = useRouter();

  const handleSignOut = async () => {
    if (auth) {
      await signOut(auth);
      router.push('/dashboard');
    }
  };

  const isPrivilegedUser =
    userProfile &&
    ['admin', 'owner', 'manager', 'TLO'].includes(userProfile.role);

  const getInitials = (name?: string) => {
    if (!name) return <User className="h-5 w-5" />;
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase();
  };

  return (
    <header className="sticky top-0 z-50 flex h-16 items-center justify-between border-b bg-background/80 backdrop-blur-sm px-4 sm:px-6">
      
      {/* LEFT SIDE */}
      <div className="flex items-center gap-3">
        <Logo />

        {/* Hide Import Shifts on Mobile */}
        {isPrivilegedUser && userProfile && (
          <div className="hidden sm:block">
            <GlobalShiftImporter userProfile={userProfile} />
          </div>
        )}
      </div>

      {/* RIGHT SIDE */}
      <div className="flex items-center gap-2 sm:gap-4">
        {user && (
          <>
            <NotificationButton />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="secondary"
                  size="icon"
                  className="rounded-full"
                >
                  <Avatar className="h-8 w-8">
                    <AvatarFallback>
                      {getInitials(userProfile?.name)}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>

              <DropdownMenuContent align="end" className="w-56">
                {userProfile?.name && (
                  <DropdownMenuLabel>
                    {userProfile.name}
                  </DropdownMenuLabel>
                )}
                {userProfile?.email && (
                  <DropdownMenuLabel className="font-normal text-muted-foreground -mt-2 pb-2">
                    {userProfile.email}
                  </DropdownMenuLabel>
                )}

                <DropdownMenuSeparator />

                <DropdownMenuItem
                  onClick={() => router.push('/dashboard')}
                  className="cursor-pointer"
                >
                  <Calendar className="mr-2 h-4 w-4" />
                  Dashboard
                </DropdownMenuItem>

                <DropdownMenuItem
                  onClick={() => router.push('/site-schedule')}
                  className="cursor-pointer"
                >
                  <Building2 className="mr-2 h-4 w-4" />
                  Site Schedule
                </DropdownMenuItem>

                <DropdownMenuItem
                  onSelect={() =>
                    window.open(
                      'https://studio--studio-6303842196-5daf6.us-central1.hosted.app',
                      '_blank'
                    )
                  }
                  className="cursor-pointer"
                >
                  <Fingerprint className="mr-2 h-4 w-4" />
                  Digital Sign In/Out
                </DropdownMenuItem>

                <DropdownMenuItem
                  onClick={() => router.push('/announcements')}
                  className="cursor-pointer"
                >
                  <Megaphone className="mr-2 h-4 w-4" />
                  Announcements
                </DropdownMenuItem>

                <DropdownMenuItem
                  onClick={() => router.push('/stats')}
                  className="cursor-pointer"
                >
                  <TrendingUp className="mr-2 h-4 w-4" />
                  Stats
                </DropdownMenuItem>

                <DropdownMenuItem
                  onClick={() => router.push('/ai')}
                  className="cursor-pointer"
                >
                  <Wand2 className="mr-2 h-4 w-4" />
                  AI Assistant
                </DropdownMenuItem>

                <DropdownMenuItem
                  onClick={() => router.push('/projects')}
                  className="cursor-pointer"
                >
                  <Briefcase className="mr-2 h-4 w-4" />
                  Projects
                </DropdownMenuItem>

                <DropdownMenuItem
                  onClick={() =>
                    router.push('/health-and-safety')
                  }
                  className="cursor-pointer"
                >
                  <HardHat className="mr-2 h-4 w-4" />
                  Health & Safety
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                <DropdownMenuItem
                  onClick={() => router.push('/help')}
                  className="cursor-pointer"
                >
                  <HelpCircle className="mr-2 h-4 w-4" />
                  Help & Support
                </DropdownMenuItem>

                {isPrivilegedUser && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>
                      Admin Area
                    </DropdownMenuLabel>

                    <DropdownMenuItem
                      onClick={() =>
                        router.push('/admin/control-panel')
                      }
                      className="cursor-pointer"
                    >
                      <Shield className="mr-2 h-4 w-4" />
                      Control Panel
                    </DropdownMenuItem>

                    <DropdownMenuItem
                      onClick={() => router.push('/schedule')}
                      className="cursor-pointer"
                    >
                      <Users className="mr-2 h-4 w-4" />
                      Team Schedule
                    </DropdownMenuItem>

                    <DropdownMenuItem
                      onClick={() =>
                        router.push('/admin/availability')
                      }
                      className="cursor-pointer"
                    >
                      <Calendar className="mr-2 h-4 w-4" />
                      Availability
                    </DropdownMenuItem>

                    <DropdownMenuItem
                      onClick={() =>
                        router.push('/admin/contracts')
                      }
                      className="cursor-pointer"
                    >
                      <Briefcase className="mr-2 h-4 w-4" />
                      Contracts
                    </DropdownMenuItem>

                    <DropdownMenuItem
                      onClick={() =>
                        router.push('/admin/performance')
                      }
                      className="cursor-pointer"
                    >
                      <TrendingUp className="mr-2 h-4 w-4" />
                      Performance
                    </DropdownMenuItem>

                    <DropdownMenuItem
                      onClick={() =>
                        router.push('/admin/tasks')
                      }
                      className="cursor-pointer"
                    >
                      <ListChecks className="mr-2 h-4 w-4" />
                      Tasks
                    </DropdownMenuItem>

                    <DropdownMenuItem
                      onClick={() =>
                        router.push('/admin/users')
                      }
                      className="cursor-pointer"
                    >
                      <UserCog className="mr-2 h-4 w-4" />
                      User Management
                    </DropdownMenuItem>

                    <DropdownMenuItem
                      onClick={() =>
                        router.push('/admin/evidence')
                      }
                      className="cursor-pointer"
                    >
                      <FileArchive className="mr-2 h-4 w-4" />
                      Evidence
                    </DropdownMenuItem>
                  </>
                )}

                <DropdownMenuSeparator />

                <DropdownMenuItem
                  onClick={handleSignOut}
                  className="cursor-pointer"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>
    </header>
  );
}
