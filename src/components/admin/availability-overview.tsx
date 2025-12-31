
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
import { Users, Sun, Moon } from 'lucide-react';

interface AvailableUser {
  user: UserProfile;
  availability: 'full' | 'am' | 'pm';
}

const getInitials = (name?: string) => {
    if (!name) return '??';
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase();
};

const AvailabilityList = ({ title, users, icon: Icon, color }: { title: string, users: UserProfile[], icon: React.ElementType, color: string }) => {
    if (users.length === 0) return null;
    return (
        <div>
            <h4 className={`font-semibold mb-3 flex items-center gap-2 ${color}`}>
                <Icon className="h-5 w-5" />
                {title} ({users.length})
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {users.map(user => (
                    <div key={user.uid} className="flex flex-col items-center text-center gap-2">
                        <Avatar>
                            <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
                        </Avatar>
                        <p className="text-xs font-medium">{user.name}</p>
                    </div>
                ))}
            </div>
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

    const todaysAvailability = useMemo((): AvailableUser[] => {
        if (loading) return [];
        
        const todaysShifts = shifts.filter(s => isToday(getCorrectedLocalDate(s.date)));
        
        return users.map(user => {
            const userShiftsToday = todaysShifts.filter(s => s.userId === user.uid);
            
            if (userShiftsToday.length === 0) {
                return { user, availability: 'full' };
            }
            if (userShiftsToday.some(s => s.type === 'all-day')) {
                return null;
            }
            if (userShiftsToday.length === 1) {
                if (userShiftsToday[0].type === 'am') {
                    return { user, availability: 'pm' };
                }
                if (userShiftsToday[0].type === 'pm') {
                    return { user, availability: 'am' };
                }
            }
            // If user has 2+ shifts (one am, one pm), they are not available
            return null;
        }).filter((u): u is AvailableUser => u !== null);

    }, [loading, shifts, users]);

    const fullyAvailable = useMemo(() => todaysAvailability.filter(u => u.availability === 'full').map(u => u.user), [todaysAvailability]);
    const amAvailable = useMemo(() => todaysAvailability.filter(u => u.availability === 'am').map(u => u.user), [todaysAvailability]);
    const pmAvailable = useMemo(() => todaysAvailability.filter(u => u.availability === 'pm').map(u => u.user), [todaysAvailability]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Today's Availability</CardTitle>
        <CardDescription>
          A simple overview of which operatives are available today.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
            <div className="space-y-4">
                <Skeleton className="h-8 w-1/4" />
                <div className="grid grid-cols-5 gap-4">
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                </div>
            </div>
        ) : todaysAvailability.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center h-48">
              <Users className="mx-auto h-12 w-12 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-semibold">No Operatives Available Today</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                All operatives are scheduled for the full day.
              </p>
            </div>
        ) : (
            <div className="space-y-8">
                <AvailabilityList title="Fully Available" users={fullyAvailable} icon={Users} color="text-green-600" />
                <AvailabilityList title="AM Available" users={amAvailable} icon={Sun} color="text-sky-600" />
                <AvailabilityList title="PM Available" users={pmAvailable} icon={Moon} color="text-orange-600" />
            </div>
        )}
      </CardContent>
    </Card>
  );
}
