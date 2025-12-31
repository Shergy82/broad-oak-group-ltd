
'use client';

import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Shift, UserProfile } from '@/types';
import { isToday } from 'date-fns';
import { getCorrectedLocalDate } from '@/lib/utils';
import { Avatar, AvatarFallback } from '../ui/avatar';
import { Skeleton } from '../ui/skeleton';
import { Users, Sun, Moon, MapPin, HardHat } from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Spinner } from '../shared/spinner';


interface AvailableUser {
  user: UserProfile;
  availability: 'full' | 'am' | 'pm' | 'busy';
  shiftLocation?: string;
}

const getInitials = (name?: string) => {
    if (!name) return '??';
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase();
};

const extractLocation = (address: string | undefined): string => {
    if (!address) return '';

    const postcodeRegex = /(L|l)ondon\s+([A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})/i;
    const match = address.match(postcodeRegex);

    if (match && match[0]) {
        return match[0].trim();
    }
    
    const genericPostcodeRegex = /([A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})$/i;
    const genericMatch = address.match(genericPostcodeRegex);
    if (genericMatch && genericMatch[0]) {
        return genericMatch[0].trim();
    }
    
    const parts = address.split(',');
    return parts[parts.length - 1].trim();
};


const UserAvatarList = ({ users }: { users: AvailableUser[] }) => {
    if (users.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center h-full">
                <Users className="mx-auto h-10 w-10 text-muted-foreground" />
                <p className="mt-2 text-sm text-muted-foreground">No operatives in this category.</p>
            </div>
        );
    }
    return (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
            {users.map(({ user, shiftLocation, availability }) => (
                <div key={user.uid} className="flex flex-col items-center text-center gap-2">
                    <Avatar className="h-16 w-16 text-lg">
                        <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col">
                        <p className="text-sm font-medium truncate w-full">{user.name}</p>
                        {shiftLocation && (
                            <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                                <MapPin className="h-3 w-3 shrink-0" />
                                <span className="truncate">{extractLocation(shiftLocation)}</span>
                            </div>
                        )}
                         {availability === 'am' && <p className="text-xs font-semibold text-sky-600">AM Free</p>}
                         {availability === 'pm' && <p className="text-xs font-semibold text-orange-600">PM Free</p>}
                    </div>
                </div>
            ))}
        </div>
    )
}

export function AvailabilityOverview() {
    const [shifts, setShifts] = useState<Shift[]>([]);
    const [users, setUsers] = useState<UserProfile[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const shiftsQuery = query(collection(db, 'shifts'));
        const usersQuery = query(collection(db, 'users'));

        let shiftsLoaded = false;
        let usersLoaded = false;

        const checkAllLoaded = () => {
            if (shiftsLoaded && usersLoaded) {
                setLoading(false);
            }
        }

        const unsubShifts = onSnapshot(shiftsQuery, (snapshot) => {
            setShifts(snapshot.docs.map(doc => doc.data() as Shift));
            shiftsLoaded = true;
            checkAllLoaded();
        });

        const unsubUsers = onSnapshot(usersQuery, (snapshot) => {
            setUsers(snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile)).filter(u => u.role === 'user' || u.role === 'TLO'));
            usersLoaded = true;
            checkAllLoaded();
        });

        return () => {
            unsubShifts();
            unsubUsers();
        };
    }, []);

    const todaysAvailability: AvailableUser[] = useMemo(() => {
        if (loading) return [];
        
        const todaysShifts = shifts.filter(s => isToday(getCorrectedLocalDate(s.date)));
        
        return users.map(user => {
            const userShiftsToday = todaysShifts.filter(s => s.userId === user.uid);
            
            if (userShiftsToday.length === 0) {
                return { user, availability: 'full' };
            }
            if (userShiftsToday.some(s => s.type === 'all-day') || userShiftsToday.length >= 2) {
                 return { user, availability: 'busy' };
            }
            if (userShiftsToday.length === 1) {
                const shift = userShiftsToday[0];
                if (shift.type === 'am') {
                    return { user, availability: 'pm', shiftLocation: shift.address };
                }
                if (shift.type === 'pm') {
                    return { user, availability: 'am', shiftLocation: shift.address };
                }
            }
            // If it's an all-day shift it gets caught by the 'busy' case above
            return null;
        }).filter((u): u is AvailableUser => u !== null);

    }, [loading, shifts, users]);
    
    const { workingToday, fullyAvailable, semiAvailable } = useMemo(() => {
        return {
            workingToday: todaysAvailability.filter(u => u.availability === 'busy' || u.availability === 'am' || u.availability === 'pm'),
            fullyAvailable: todaysAvailability.filter(u => u.availability === 'full'),
            semiAvailable: todaysAvailability.filter(u => u.availability === 'am' || u.availability === 'pm'),
        }
    }, [todaysAvailability]);


  return (
    <Card>
      <CardHeader>
        <CardTitle>Today's Availability</CardTitle>
        <CardDescription>
          A simple overview of which operatives are available today. Click a category to expand.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
            <div className="flex items-center justify-center h-48">
                <Spinner size="lg" />
            </div>
        ) : (
            <Accordion type="multiple" className="w-full">
                <AccordionItem value="working-today">
                    <AccordionTrigger className="text-base font-semibold">
                         <div className="flex items-center gap-3">
                            <HardHat /> Working Today ({workingToday.length})
                         </div>
                    </AccordionTrigger>
                    <AccordionContent className="pt-6">
                        <UserAvatarList users={workingToday} />
                    </AccordionContent>
                </AccordionItem>
                 <AccordionItem value="fully-available">
                    <AccordionTrigger className="text-base font-semibold">
                        <div className="flex items-center gap-3">
                            <Sun /> Fully Available ({fullyAvailable.length})
                        </div>
                    </AccordionTrigger>
                    <AccordionContent className="pt-6">
                        <UserAvatarList users={fullyAvailable} />
                    </AccordionContent>
                </AccordionItem>
                 <AccordionItem value="semi-available">
                    <AccordionTrigger className="text-base font-semibold">
                         <div className="flex items-center gap-3">
                            <Moon /> Semi-Available ({semiAvailable.length})
                        </div>
                    </AccordionTrigger>
                    <AccordionContent className="pt-6">
                        <UserAvatarList users={semiAvailable} />
                    </AccordionContent>
                </AccordionItem>
            </Accordion>
        )}
      </CardContent>
    </Card>
  );
}
