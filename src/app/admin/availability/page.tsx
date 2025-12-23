
'use client';

import { useEffect, useMemo, useState } from 'react';
import { addDays, format, startOfDay } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Shift, UserProfile } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Calendar } from '@/components/ui/calendar';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { Calendar as CalendarIcon, Users, UserCheck, UserX } from 'lucide-react';
import { getCorrectedLocalDate, isWithin } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

const getInitials = (name?: string) => {
    if (!name) return '??';
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase();
};

export default function AvailabilityPage() {
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
      from: startOfDay(new Date()),
      to: startOfDay(new Date()),
  });
  const [allShifts, setAllShifts] = useState<Shift[]>([]);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    let shiftsLoaded = false;
    let usersLoaded = false;

    const checkAllDataLoaded = () => {
        if (shiftsLoaded && usersLoaded) {
            setLoading(false);
        }
    };
    
    const shiftsQuery = query(collection(db, 'shifts'));
    const unsubShifts = onSnapshot(shiftsQuery, (snapshot) => {
        setAllShifts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Shift)));
        shiftsLoaded = true;
        checkAllDataLoaded();
    }, (err) => {
        console.error("Error fetching shifts:", err);
        shiftsLoaded = true;
        checkAllDataLoaded();
    });

    const usersQuery = query(collection(db, 'users'));
    const unsubUsers = onSnapshot(usersQuery, (snapshot) => {
        const fetchedUsers = snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile));
        setAllUsers(fetchedUsers.filter(u => u.role === 'user').sort((a,b) => a.name.localeCompare(b.name)));
        usersLoaded = true;
        checkAllDataLoaded();
    }, (err) => {
        console.error("Error fetching users:", err);
        usersLoaded = true;
        checkAllDataLoaded();
    });

    return () => {
        unsubShifts();
        unsubUsers();
    };
  }, []);

  const { availableUsers } = useMemo(() => {
    if (!dateRange?.from || allUsers.length === 0) {
      return { availableUsers: allUsers };
    }
    
    const start = startOfDay(dateRange.from);
    const end = dateRange.to ? startOfDay(dateRange.to) : start;

    const interval = { start, end };
    
    const shiftsInInterval = allShifts.filter(shift => {
        const shiftDate = getCorrectedLocalDate(shift.date);
        return isWithin(shiftDate, interval);
    });

    const busyUserIds = new Set<string>();
    shiftsInInterval.forEach(shift => {
        busyUserIds.add(shift.userId);
    });
    
    const available = allUsers.filter(user => !busyUserIds.has(user.uid));

    return { availableUsers: available };

  }, [dateRange, allShifts, allUsers]);

  const selectedPeriodText = () => {
    if (!dateRange?.from) return 'No date selected';
    const start = format(dateRange.from, 'PPP');
    if (!dateRange.to || format(dateRange.from, 'PPP') === format(dateRange.to, 'PPP')) {
        return `for ${start}`;
    }
    const end = format(dateRange.to, 'PPP');
    return `from ${start} to ${end}`;
  }
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>Operative Availability</CardTitle>
        <CardDescription>
          Select a date or a date range to view which operatives are available.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-1 flex justify-center">
             <Calendar
                mode="range"
                selected={dateRange}
                onSelect={setDateRange}
                className="rounded-md border"
                defaultMonth={dateRange?.from}
                numberOfMonths={1}
            />
        </div>
        <div className="md:col-span-2">
           {loading ? (
             <div className="space-y-4">
                 <Skeleton className="h-8 w-1/2" />
                 <Skeleton className="h-32 w-full" />
             </div>
           ) : !dateRange?.from ? (
            <Alert>
                <CalendarIcon className="h-4 w-4" />
                <AlertTitle>Select a Date</AlertTitle>
                <AlertDescription>
                    Click on the calendar to select a date or drag to select a range.
                </AlertDescription>
            </Alert>
           ) : (
             <div className="space-y-6">
                <div>
                    <h3 className="text-lg font-semibold flex items-center gap-2 mb-3">
                        <UserCheck className="text-green-600 h-5 w-5"/>
                        Available Operatives ({availableUsers.length})
                         <span className="text-sm font-normal text-muted-foreground ml-2">{selectedPeriodText()}</span>
                    </h3>
                     {availableUsers.length > 0 ? (
                        <div className="flex flex-wrap gap-4">
                           {availableUsers.map(user => (
                               <div key={user.uid} className="flex items-center gap-2 p-2 border rounded-md bg-muted/50">
                                   <Avatar className="h-8 w-8">
                                       <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
                                   </Avatar>
                                   <p className="text-sm font-medium">{user.name}</p>
                               </div>
                           ))}
                        </div>
                    ) : (
                         <Alert className="border-dashed">
                            <Users className="h-4 w-4" />
                            <AlertTitle>No Operatives Available</AlertTitle>
                            <AlertDescription>All operatives have assigned shifts in the selected period.</AlertDescription>
                        </Alert>
                    )}
                </div>
             </div>
           )}
        </div>
      </CardContent>
    </Card>
  );
}

