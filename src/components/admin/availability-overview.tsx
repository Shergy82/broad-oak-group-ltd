'use client';

import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Shift, UserProfile, Unavailability } from '@/types';
import { isToday, startOfToday } from 'date-fns';
import { getCorrectedLocalDate } from '@/lib/utils';
import { Avatar, AvatarFallback } from '../ui/avatar';
import { Users, Sun, Moon, MapPin, HardHat, CalendarOff } from 'lucide-react';
import { Spinner } from '../shared/spinner';
import { Button } from '../ui/button';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Badge } from '../ui/badge';
import { ScrollArea } from '../ui/scroll-area';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';


interface AvailableUser {
  user: UserProfile;
  availability: 'full' | 'am' | 'pm' | 'busy' | 'unavailable';
  shifts: Shift[];
}

const getInitials = (name?: string) => {
    if (!name) return '??';
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase();
};

const extractPostcode = (address: string | undefined): string | null => {
    if (!address) return null;
    // Regex for UK postcodes. More robust.
    const postcodeRegex = /([A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})$/i;
    const match = address.match(postcodeRegex);
    return match ? match[0].trim().toUpperCase() : null;
};


const UserAvatarList = ({ users, category, onUserClick }: { users: AvailableUser[]; category: 'working' | 'full' | 'semi' | 'unavailable', onUserClick: (user: AvailableUser) => void; }) => {
    
    let filteredUsers = users;
    if (category === 'working') {
        filteredUsers = users.filter(u => u.availability === 'busy');
    } else if (category === 'full') {
        filteredUsers = users.filter(u => u.availability === 'full');
    } else if (category === 'semi') {
        filteredUsers = users.filter(u => u.availability === 'am' || u.availability === 'pm');
    } else if (category === 'unavailable') {
        filteredUsers = users.filter(u => u.availability === 'unavailable');
    }

    if (filteredUsers.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center h-full min-h-[150px]">
                <Users className="mx-auto h-10 w-10 text-muted-foreground" />
                <p className="mt-2 text-sm text-muted-foreground">No operatives in this category.</p>
            </div>
        );
    }
    return (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {filteredUsers.map((availableUser) => {
                const { user, shifts, availability } = availableUser;
                
                const uniqueAddresses = [...new Set(shifts.map(s => s.address).filter(Boolean))];
                
                const isClickable = availability !== 'full' && availability !== 'unavailable';
                return (
                    <Card 
                        key={user.uid} 
                        className={cn(
                            "overflow-hidden text-center",
                            isClickable && "cursor-pointer transition-all hover:shadow-md hover:border-primary/50"
                        )}
                        onClick={() => isClickable && onUserClick(availableUser)}
                    >
                        <CardContent className="p-4 flex flex-col items-center justify-center gap-3">
                            <Avatar className="h-16 w-16 text-lg">
                                <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
                            </Avatar>
                            <div className="flex flex-col items-center space-y-1">
                                <p className="text-sm font-semibold truncate w-full max-w-[150px]">{user.name}</p>
                                {uniqueAddresses.length > 0 && (
                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                                    <MapPin className="h-3 w-3 shrink-0" />
                                                    <span className="truncate max-w-[120px]">
                                                        {uniqueAddresses.length === 1 ? extractPostcode(uniqueAddresses[0]) || uniqueAddresses[0] : `${uniqueAddresses.length} locations`}
                                                    </span>
                                                </div>
                                            </TooltipTrigger>
                                            <TooltipContent>
                                                {uniqueAddresses.map((addr, i) => <p key={i}>{addr}</p>)}
                                            </TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                )}
                            </div>
                            {availability === 'am' && <Badge variant="outline" className="text-sky-600 border-sky-200 bg-sky-50 dark:bg-sky-900/50 dark:text-sky-300 dark:border-sky-800">AM Free</Badge>}
                            {availability === 'pm' && <Badge variant="outline" className="text-orange-600 border-orange-200 bg-orange-50 dark:bg-orange-900/50 dark:text-orange-300 dark:border-orange-800">PM Free</Badge>}
                        </CardContent>
                    </Card>
                )
            })}
        </div>
    )
}

type ActiveTab = 'working-today' | 'fully-available' | 'semi-available' | 'unavailable' | null;

interface AvailabilityOverviewProps {
    userProfile: UserProfile; // Added for type-safety with dashboard
    viewMode?: 'normal' | 'simple';
}


export function AvailabilityOverview({ viewMode = 'normal' }: AvailabilityOverviewProps) {
    const [shifts, setShifts] = useState<Shift[]>([]);
    const [users, setUsers] = useState<UserProfile[]>([]);
    const [unavailability, setUnavailability] = useState<Unavailability[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<ActiveTab>(null);
    const [selectedUserShifts, setSelectedUserShifts] = useState<AvailableUser | null>(null);

    useEffect(() => {
        if (viewMode === 'normal') {
            setActiveTab('working-today');
        } else {
            setActiveTab(null);
        }
    }, [viewMode]);

    useEffect(() => {
        const shiftsQuery = query(collection(db, 'shifts'));
        const usersQuery = query(collection(db, 'users'));
        const unavailabilityQuery = query(collection(db, 'unavailability'));

        let shiftsLoaded = false;
        let usersLoaded = false;
        let unavailabilityLoaded = false;

        const checkAllLoaded = () => {
            if (shiftsLoaded && usersLoaded && unavailabilityLoaded) {
                setLoading(false);
            }
        }

        const unsubShifts = onSnapshot(shiftsQuery, (snapshot) => {
            setShifts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Shift)));
            shiftsLoaded = true;
            checkAllLoaded();
        });

        const unsubUsers = onSnapshot(usersQuery, (snapshot) => {
            setUsers(snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile)));
            usersLoaded = true;
            checkAllLoaded();
        });

        const unsubUnavailability = onSnapshot(unavailabilityQuery, (snapshot) => {
            setUnavailability(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Unavailability)));
            unavailabilityLoaded = true;
            checkAllLoaded();
        });

        return () => {
            unsubShifts();
            unsubUsers();
            unsubUnavailability();
        };
    }, []);

    const todaysAvailability: AvailableUser[] = useMemo(() => {
        if (loading) return [];
        
        const todaysShifts = shifts.filter(s => isToday(getCorrectedLocalDate(s.date)));
        const todaysDate = startOfToday();
        const todaysUnavailable = unavailability.filter(u => {
            const startDate = getCorrectedLocalDate(u.startDate);
            const endDate = getCorrectedLocalDate(u.endDate);
            return todaysDate >= startDate && todaysDate <= endDate;
        });
        const unavailableUserIds = new Set(todaysUnavailable.map(u => u.userId));

        
        return users.map(user => {
            if (unavailableUserIds.has(user.uid)) {
                return { user, availability: 'unavailable', shifts: [] };
            }

            const userShiftsToday = todaysShifts.filter(s => s.userId === user.uid);
            
            if (userShiftsToday.length === 0) {
                return { user, availability: 'full', shifts: [] };
            }

            const hasAmShift = userShiftsToday.some(s => s.type === 'am' || s.type === 'all-day');
            const hasPmShift = userShiftsToday.some(s => s.type === 'pm' || s.type === 'all-day');

            if (hasAmShift && hasPmShift) {
                 return { user, availability: 'busy', shifts: userShiftsToday };
            } else if (hasAmShift) { 
                 return { user, availability: 'pm', shifts: userShiftsToday };
            } else if (hasPmShift) {
                 return { user, availability: 'am', shifts: userShiftsToday };
            }

            // This should not be reached if logic is correct, but as a fallback:
            return { user, availability: 'busy', shifts: userShiftsToday };
        }).filter((u): u is AvailableUser => u !== null);

    }, [loading, shifts, users, unavailability]);
    
    const { workingTodayCount, fullyAvailableCount, semiAvailableCount, unavailableCount } = useMemo(() => {
        return {
            workingTodayCount: todaysAvailability.filter(u => u.availability === 'busy').length,
            fullyAvailableCount: todaysAvailability.filter(u => u.availability === 'full').length,
            semiAvailableCount: todaysAvailability.filter(u => u.availability === 'am' || u.availability === 'pm').length,
            unavailableCount: todaysAvailability.filter(u => u.availability === 'unavailable').length,
        }
    }, [todaysAvailability]);

    const handleTabClick = (tab: ActiveTab) => {
        if (viewMode === 'simple') return;
        if (activeTab === tab) {
            setActiveTab(null); // Close if the same tab is clicked
        } else {
            setActiveTab(tab);
        }
    };
    
    const handleUserClick = (user: AvailableUser) => {
        setSelectedUserShifts(user);
    };

    const renderContent = () => {
        if (!activeTab) return null;
        switch (activeTab) {
            case 'working-today':
                return <UserAvatarList users={todaysAvailability} category="working" onUserClick={handleUserClick} />;
            case 'fully-available':
                return <UserAvatarList users={todaysAvailability} category="full" onUserClick={handleUserClick} />;
            case 'semi-available':
                return <UserAvatarList users={todaysAvailability} category="semi" onUserClick={handleUserClick} />;
            case 'unavailable':
                return <UserAvatarList users={todaysAvailability} category="unavailable" onUserClick={handleUserClick} />;
            default:
                return null;
        }
    };


  return (
    <>
    <Card>
      <CardHeader>
        <CardTitle>Today's Availability</CardTitle>
        <CardDescription>
          A simple overview of which operatives are available today. Click a category to view.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
            <div className="flex items-center justify-center h-48">
                <Spinner size="lg" />
            </div>
        ) : (
            <div className="w-full space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    
                    <Card
                        className={cn(
                            "transition-colors",
                            viewMode === 'normal' && "cursor-pointer hover:bg-muted",
                            activeTab === 'working-today' && "ring-2 ring-primary bg-muted"
                        )}
                        onClick={() => handleTabClick('working-today')}
                    >
                        <CardContent className="p-4 flex items-center gap-4">
                            <HardHat className="h-8 w-8 text-muted-foreground" />
                            <div className="flex flex-col">
                                <span className="font-semibold">Working Today</span>
                                <span className="text-2xl font-bold">{workingTodayCount}</span>
                            </div>
                        </CardContent>
                    </Card>

                    <Card
                        className={cn(
                            "transition-colors",
                            viewMode === 'normal' && "cursor-pointer hover:bg-muted",
                            activeTab === 'fully-available' && "ring-2 ring-primary bg-muted"
                        )}
                        onClick={() => handleTabClick('fully-available')}
                    >
                         <CardContent className="p-4 flex items-center gap-4">
                            <Sun className="h-8 w-8 text-muted-foreground" />
                            <div className="flex flex-col">
                                <span className="font-semibold">Fully Available</span>
                                <span className="text-2xl font-bold">{fullyAvailableCount}</span>
                            </div>
                        </CardContent>
                    </Card>

                    <Card
                        className={cn(
                            "transition-colors",
                            viewMode === 'normal' && "cursor-pointer hover:bg-muted",
                            activeTab === 'semi-available' && "ring-2 ring-primary bg-muted"
                        )}
                        onClick={() => handleTabClick('semi-available')}
                    >
                        <CardContent className="p-4 flex items-center gap-4">
                            <Moon className="h-8 w-8 text-muted-foreground" />
                             <div className="flex flex-col">
                                <span className="font-semibold">Semi-Available</span>
                                <span className="text-2xl font-bold">{semiAvailableCount}</span>
                            </div>
                        </CardContent>
                    </Card>

                     <Card
                        className={cn(
                            "transition-colors",
                            viewMode === 'normal' && "cursor-pointer hover:bg-muted",
                            activeTab === 'unavailable' && "ring-2 ring-primary bg-muted"
                        )}
                        onClick={() => handleTabClick('unavailable')}
                    >
                        <CardContent className="p-4 flex items-center gap-4">
                            <CalendarOff className="h-8 w-8 text-muted-foreground" />
                             <div className="flex flex-col">
                                <span className="font-semibold">Unavailable</span>
                                <span className="text-2xl font-bold">{unavailableCount}</span>
                            </div>
                        </CardContent>
                    </Card>

                </div>
                
                <div className="pt-4 transition-all duration-300 ease-in-out">
                    {viewMode === 'normal' && renderContent()}
                </div>
            </div>
        )}
      </CardContent>
    </Card>
    {selectedUserShifts && (
      <Dialog open={!!selectedUserShifts} onOpenChange={() => setSelectedUserShifts(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Today's Shifts for {selectedUserShifts.user.name}</DialogTitle>
            <DialogDescription>
              Below are the shifts scheduled for {selectedUserShifts.user.name} today.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] -mx-4 px-4">
            <div className="space-y-4 py-4">
              {selectedUserShifts.shifts.map(shift => (
                <Card key={shift.id}>
                  <CardHeader>
                      <CardTitle className="text-base">{shift.task}</CardTitle>
                      <CardDescription>{shift.address}</CardDescription>
                  </CardHeader>
                  <CardContent className="grid grid-cols-2 gap-2 text-sm">
                     <div>
                         <p className="font-medium">Type</p>
                         <Badge variant="outline" className="capitalize">{shift.type === 'all-day' ? 'All Day' : shift.type}</Badge>
                     </div>
                      <div>
                         <p className="font-medium">Status</p>
                         <Badge variant="secondary" className="capitalize">{shift.status.replace('-', ' ')}</Badge>
                     </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    )}
    </>
  );
}
