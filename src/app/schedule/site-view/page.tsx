
'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Shift, UserProfile } from '@/types';
import { isSameWeek, format, startOfToday } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ArrowLeft, Building2, CalendarDays, Terminal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useRouter } from 'next/navigation';
import { getCorrectedLocalDate } from '@/lib/utils';


const DayCard = ({ day, shifts, userNameMap }: { day: string, shifts: Shift[], userNameMap: Map<string, string> }) => {
    if (shifts.length === 0) return null;

    const sortedShifts = [...shifts].sort((a, b) => {
        const typeOrder = { 'am': 1, 'pm': 2, 'all-day': 3 };
        return typeOrder[a.type] - typeOrder[b.type];
    });

    return (
        <Card>
            <CardHeader>
                <CardTitle>{day}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                {sortedShifts.map(shift => (
                    <div key={shift.id} className="p-3 rounded-md bg-muted/50 border">
                        <p className="font-semibold">{shift.task}</p>
                        <p className="text-sm text-muted-foreground">{userNameMap.get(shift.userId) || 'Unknown User'}</p>
                        <p className="text-xs text-muted-foreground capitalize">{shift.type === 'all-day' ? 'All Day' : shift.type.toUpperCase()}</p>
                    </div>
                ))}
            </CardContent>
        </Card>
    );
}


export default function SiteSchedulePage() {
    const [allShifts, setAllShifts] = useState<Shift[]>([]);
    const [users, setUsers] = useState<UserProfile[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
    const router = useRouter();

    useEffect(() => {
        const shiftsQuery = query(collection(db, 'shifts'));
        const usersQuery = query(collection(db, 'users'));

        const unsubShifts = onSnapshot(shiftsQuery, (snapshot) => {
            const fetchedShifts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Shift));
            setAllShifts(fetchedShifts);
            setLoading(false);
        }, (err) => {
            console.error("Error fetching shifts:", err);
            setError("Could not fetch shift data.");
            setLoading(false);
        });
        
        const unsubUsers = onSnapshot(usersQuery, (snapshot) => {
            const fetchedUsers = snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile));
            setUsers(fetchedUsers);
        }, (err) => {
            console.error("Error fetching users:", err);
            setError("Could not fetch user data.");
        });

        return () => {
            unsubShifts();
            unsubUsers();
        };
    }, []);

    const availableAddresses = useMemo(() => {
        if (loading) return [];
        const addresses = new Set(allShifts.map(shift => shift.address));
        return Array.from(addresses).sort((a,b) => a.localeCompare(b));
    }, [allShifts, loading]);


    const userNameMap = useMemo(() => new Map(users.map(u => [u.uid, u.name])), [users]);

    const weekShifts = useMemo(() => {
        const today = startOfToday();
        
        if (!selectedAddress) {
            return {};
        }

        // Filter the fetched shifts for the selected address and current week
        const relevantShifts = allShifts.filter(s => 
            s.address === selectedAddress &&
            isSameWeek(getCorrectedLocalDate(s.date), today, { weekStartsOn: 1 })
        );

        const grouped: { [key: string]: Shift[] } = {
            'Monday': [], 'Tuesday': [], 'Wednesday': [], 'Thursday': [], 'Friday': [], 'Saturday': [], 'Sunday': [],
        };
        relevantShifts.forEach(shift => {
            const dayName = format(getCorrectedLocalDate(shift.date), 'eeee');
            if (grouped[dayName]) {
                grouped[dayName].push(shift);
            }
        });
        return grouped;
    }, [allShifts, selectedAddress]);

    const hasShifts = Object.values(weekShifts).some(dayShifts => dayShifts.length > 0);
    
    const weekDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    const weekendDays = ['Saturday', 'Sunday'];

    if (error) {
        return (
            <Alert variant="destructive">
                <Terminal className="h-4 w-4" />
                <AlertTitle>Error Loading Data</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
            </Alert>
        )
    }

    return (
        <Card>
            <CardHeader>
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div>
                        <CardTitle>Site Schedule View</CardTitle>
                        <CardDescription>Select a property to see all scheduled work for this week.</CardDescription>
                    </div>
                    <Button variant="outline" onClick={() => router.push('/schedule')}>
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Back to Team View
                    </Button>
                </div>
                <div className="pt-4">
                    <Select onValueChange={setSelectedAddress} value={selectedAddress || ''}>
                        <SelectTrigger className="w-full sm:w-[400px]">
                            <SelectValue placeholder="Select a property address..." />
                        </SelectTrigger>
                        <SelectContent>
                            {availableAddresses.map(address => (
                                <SelectItem key={address} value={address}>
                                    {address}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </CardHeader>
            <CardContent>
                {!selectedAddress ? (
                    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center h-60">
                        <Building2 className="mx-auto h-12 w-12 text-muted-foreground" />
                        <h3 className="mt-4 text-lg font-semibold">No Property Selected</h3>
                        <p className="mt-2 text-sm text-muted-foreground">Please select a property from the dropdown above.</p>
                    </div>
                ) : loading ? (
                    <div className="space-y-4">
                        <Skeleton className="h-12 w-1/3" />
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            <Skeleton className="h-48 w-full" />
                            <Skeleton className="h-48 w-full" />
                            <Skeleton className="h-48 w-full" />
                        </div>
                    </div>
                ) : !hasShifts ? (
                     <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center h-60">
                        <CalendarDays className="mx-auto h-12 w-12 text-muted-foreground" />
                        <h3 className="mt-4 text-lg font-semibold">No Shifts This Week</h3>
                        <p className="mt-2 text-sm text-muted-foreground">There is no work scheduled for "{selectedAddress}" this week.</p>
                    </div>
                ) : (
                    <div className="space-y-6">
                        <h3 className="text-xl font-semibold tracking-tight">Weekdays</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
                           {weekDays.map(day => <DayCard key={day} day={day} shifts={weekShifts[day]} userNameMap={userNameMap} />)}
                        </div>

                         {(weekShifts['Saturday']?.length > 0 || weekShifts['Sunday']?.length > 0) && (
                            <>
                                <h3 className="text-xl font-semibold tracking-tight pt-4">Weekend</h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
                                    {weekendDays.map(day => <DayCard key={day} day={day} shifts={weekShifts[day]} userNameMap={userNameMap} />)}
                                </div>
                            </>
                         )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
