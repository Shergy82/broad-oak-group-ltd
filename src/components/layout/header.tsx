
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
  Users,
  TrendingUp,
  HelpCircle,
  Fingerprint,
  Building2,
  ListChecks,
  FileArchive,
  Map,
  SlidersHorizontal,
  PoundSterling,
  UserCog,
  Share2,
  ChevronRight,
} from 'lucide-react';
import { NotificationButton } from '../shared/notification-button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuPortal,
  DropdownMenuSubContent,
  DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { GlobalShiftImporter } from '@/components/admin/global-shift-importer';
import { useDepartmentFilter } from '@/hooks/use-department-filter';
import { ShareAppLink } from './ShareAppLink';
import { useMemo, useState, useEffect } from 'react';
import { useAllUsers } from '@/hooks/use-all-users';
import { useToast } from '@/hooks/use-toast';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';


export function Header() {
  const { user } = useAuth();
  const { userProfile } = useUserProfile();
  const router = useRouter();
  const { toast } = useToast();
  const { availableDepartments, selectedDepartments, toggleDepartment, loading: deptsLoading } = useDepartmentFilter();
  const { users: allUsers } = useAllUsers();
  
  const [isClient, setIsClient] = useState(false);
  const LS_USER_MENU_COLLAPSED_KEY = 'user_menu_collapsed_v1';
  const [isUserMenuCollapsed, setIsUserMenuCollapsed] = useState(true);

  useEffect(() => {
    setIsClient(true);
    const storedState = localStorage.getItem(LS_USER_MENU_COLLAPSED_KEY);
    if (storedState !== null) {
      setIsUserMenuCollapsed(JSON.parse(storedState));
    }
  }, []);

  const handleToggleUserMenu = (event: React.SyntheticEvent) => {
    event.preventDefault();
    const newState = !isUserMenuCollapsed;
    setIsUserMenuCollapsed(newState);
    if (isClient) {
        localStorage.setItem(LS_USER_MENU_COLLAPSED_KEY, JSON.stringify(newState));
    }
  };
  
  const pendingUserCount = useMemo(() => {
    if (!userProfile || !['admin', 'owner'].includes(userProfile.role)) {
      return 0;
    }
    return allUsers.filter(u => u.status === 'pending-approval').length;
  }, [allUsers, userProfile]);

  const handleSignOut = async () => {
    if (auth) {
      await signOut(auth);
      router.push('/dashboard');
    }
  };
  
  const handleShare = () => {
    if (!userProfile?.department) {
      toast({
        title: 'Cannot Share Link',
        description: 'Your user profile does not have a department assigned.',
        variant: 'destructive',
      });
      return;
    }
    const appUrl = 'https://broad-oak-group-ltd--the-final-project-5e248.europe-west4.hosted.app';
    const department = encodeURIComponent(userProfile.department!);
    const shareUrl = `${appUrl}/signup?department=${department}`;
    navigator.clipboard.writeText(shareUrl);
    toast({
      title: 'Link Copied!',
      description: `A signup link for the ${userProfile.department} department has been copied to your clipboard.`,
    });
  };

  const isPrivilegedUser = userProfile && ['admin', 'owner', 'manager', 'TLO'].includes(userProfile.role);
  const isOwner = userProfile?.role === 'owner';
  const isAdmin = userProfile?.role === 'admin';

  const getInitials = (name?: string) => {
    if (!name) return <User className="h-5 w-5" />;
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase();
  };

  return (
    <header className="sticky top-0 flex items-start justify-between gap-4 border-b bg-background/80 backdrop-blur-sm px-4 md:px-6 z-50 py-3">
      <div className="flex flex-col items-start">
        <Logo />
        {isPrivilegedUser && userProfile && (
          <div className="pl-9 pt-1 hidden sm:flex items-center gap-2">
            <GlobalShiftImporter userProfile={userProfile} />
            <ShareAppLink />
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 md:gap-4 pt-1">
        {user && (
          <>
            <NotificationButton />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="icon" className="rounded-full relative">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback>{getInitials(userProfile?.name)}</AvatarFallback>
                  </Avatar>
                  {pendingUserCount > 0 && (
                    <span className="absolute top-0 right-0 block h-2.5 w-2.5 rounded-full bg-destructive ring-2 ring-background" />
                  )}
                  <span className="sr-only">Toggle user menu</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-[85vh]">
                {userProfile?.name && <DropdownMenuLabel>{userProfile.name}</DropdownMenuLabel>}
                {userProfile?.email && (
                  <DropdownMenuLabel className="font-normal text-muted-foreground -mt-2 pb-2">
                    {userProfile.email}
                  </DropdownMenuLabel>
                )}
                <DropdownMenuSeparator />

                {isOwner && availableDepartments.length > 0 && (
                  <>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <SlidersHorizontal className="mr-2 h-4 w-4" />
                        <span>Filter Departments</span>
                      </DropdownMenuSubTrigger>
                      <DropdownMenuPortal>
                        <DropdownMenuSubContent>
                          <DropdownMenuLabel>Visible Departments</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          {deptsLoading ? <DropdownMenuItem disabled>Loading...</DropdownMenuItem> :
                            availableDepartments.map(dept => (
                              <DropdownMenuCheckboxItem
                                key={dept}
                                checked={selectedDepartments.has(dept)}
                                onCheckedChange={() => toggleDepartment(dept)}
                                onSelect={(e) => e.preventDefault()}
                              >
                                {dept}
                              </DropdownMenuCheckboxItem>
                            ))
                          }
                        </DropdownMenuSubContent>
                      </DropdownMenuPortal>
                    </DropdownMenuSub>
                    <DropdownMenuSeparator />
                  </>
                )}
                
                {isPrivilegedUser ? (
                  <>
                    <DropdownMenuItem onSelect={handleToggleUserMenu} className="cursor-pointer">
                      <div className="flex w-full items-center justify-between">
                        <div className="flex items-center">
                          <User className="mr-2 h-4 w-4" />
                          <span>User Menu</span>
                        </div>
                        <ChevronRight className={cn("h-4 w-4 transition-transform", !isUserMenuCollapsed && "rotate-90")} />
                      </div>
                    </DropdownMenuItem>
                    {!isUserMenuCollapsed && (
                      <div className="pl-4">
                        <DropdownMenuItem onClick={() => router.push('/dashboard')} className="cursor-pointer">
                          <Calendar className="mr-2" />
                          <span>Dashboard</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => router.push('/ai')} className="cursor-pointer">
                          <Map className="mr-2" />
                          <span>AI Assistant</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => router.push('/site-schedule')} className="cursor-pointer">
                          <Building2 className="mr-2" />
                          <span>Site Schedule</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => window.open('https://studio--studio-6303842196-5daf6.us-central1.hosted.app', '_blank')}
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
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <DropdownMenuItem onClick={() => router.push('/dashboard')} className="cursor-pointer">
                      <Calendar className="mr-2" />
                      <span>Dashboard</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => router.push('/ai')} className="cursor-pointer">
                      <Map className="mr-2" />
                      <span>AI Assistant</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => router.push('/site-schedule')} className="cursor-pointer">
                      <Building2 className="mr-2" />
                      <span>Site Schedule</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => window.open('https://studio--studio-6303842196-5daf6.us-central1.hosted.app', '_blank')}
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
                  </>
                )}


                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => router.push('/help')} className="cursor-pointer">
                  <HelpCircle className="mr-2" />
                  <span>Help & Support</span>
                </DropdownMenuItem>

                {isPrivilegedUser && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Admin Area</DropdownMenuLabel>
                    <ScrollArea className="max-h-[200px]">
                        <DropdownMenuItem onClick={() => router.push('/admin/control-panel')} className="cursor-pointer">
                        <Shield className="mr-2" />
                        <span>Control Panel</span>
                        </DropdownMenuItem>
                        {(isOwner || isAdmin) && (
                            <DropdownMenuItem onClick={() => router.push('/admin/user-management')} className="cursor-pointer">
                                <UserCog className="mr-2" />
                                <span>User Management</span>
                                {pendingUserCount > 0 && (
                                    <span className="ml-auto flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-xs font-medium text-destructive-foreground">{pendingUserCount}</span>
                                )}
                            </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => router.push('/schedule')} className="cursor-pointer">
                        <Users className="mr-2" />
                        <span>Team Schedule</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => router.push('/admin/availability')} className="cursor-pointer">
                        <Calendar className="mr-2" />
                        <span>Availability</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => router.push('/admin/staff-ai')} className="cursor-pointer">
                        <Map className="mr-2" />
                        <span>Mapping</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => router.push('/admin/contracts')} className="cursor-pointer">
                        <Briefcase className="mr-2" />
                        <span>Contracts</span>
                        </DropdownMenuItem>
                        {userProfile?.department === 'Build' && (
                            <DropdownMenuItem onClick={() => router.push('/admin/finance')} className="cursor-pointer">
                                <PoundSterling className="mr-2 h-4 w-4" />
                                <span>Finance</span>
                            </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => router.push('/admin/performance')} className="cursor-pointer">
                        <TrendingUp className="mr-2" />
                        <span>Performance</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => router.push('/admin/tasks')} className="cursor-pointer">
                        <ListChecks className="mr-2" />
                        <span>Tasks</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => router.push('/admin/evidence')} className="cursor-pointer">
                        <FileArchive className="mr-2" />
                        <span>Evidence</span>
                        </DropdownMenuItem>
                    </ScrollArea>
                    <DropdownMenuItem onClick={handleShare} className="cursor-pointer">
                      <Share2 className="mr-2 h-4 w-4" />
                      <span>Share Signup Link</span>
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
