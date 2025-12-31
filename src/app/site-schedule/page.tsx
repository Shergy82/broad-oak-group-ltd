
'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, getDocs, where, doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Shift, UserProfile } from '@/types';
import { isSameWeek, format, startOfToday, addDays, subDays, startOfWeek, isSameDay } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Building2, CalendarDays, Download, Search, Terminal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getCorrectedLocalDate } from '@/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Header } from '@/components/layout/header';
import { useAuth } from '@/hooks/use-auth';
import { useRouter } from 'next/navigation';
import { Spinner } from '@/components/shared/spinner';
import { useUserProfile } from '@/hooks/use-user-profile';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';


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
                        <p className="text-sm text-muted-foreground">{userNameMap.get(shift.userId) || shift.userName || 'Unknown User'}</p>
                        <p className="text-xs text-muted-foreground capitalize">{shift.type === 'all-day' ? 'All Day' : shift.type.toUpperCase()}</p>
                    </div>
                ))}
            </CardContent>
        </Card>
    );
}

const WeekScheduleView = ({ shifts, weekName, userNameMap }: { shifts: { [key: string]: Shift[] }, weekName: string, userNameMap: Map<string, string> }) => {
    const hasShifts = Object.values(shifts).some(dayShifts => dayShifts.length > 0);
    const weekDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    const weekendDays = ['Saturday', 'Sunday'];

    if (!hasShifts) {
        return (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center h-60">
                <CalendarDays className="mx-auto h-12 w-12 text-muted-foreground" />
                <h3 className="mt-4 text-lg font-semibold">No Shifts {weekName}</h3>
                <p className="mt-2 text-sm text-muted-foreground">There is no work scheduled for this property during this period.</p>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <h3 className="text-xl font-semibold tracking-tight">Weekdays</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
                {weekDays.map(day => <DayCard key={day} day={day} shifts={shifts[day] || []} userNameMap={userNameMap} />)}
            </div>

            {(shifts['Saturday']?.length > 0 || shifts['Sunday']?.length > 0) && (
                <>
                    <h3 className="text-xl font-semibold tracking-tight pt-4">Weekend</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
                        {weekendDays.map(day => <DayCard key={day} day={day} shifts={shifts[day] || []} userNameMap={userNameMap} />)}
                    </div>
                </>
            )}
        </div>
    );
}


export default function SiteSchedulePage() {
    const { user, isLoading: isAuthLoading } = useAuth();
    const { userProfile, loading: isProfileLoading } = useUserProfile();
    const router = useRouter();
    const [allShifts, setAllShifts] = useState<Shift[]>([]);
    const [users, setUsers] = useState<UserProfile[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
    const [addressSearchTerm, setAddressSearchTerm] = useState('');
    const { toast } = useToast();
    
    const isPrivilegedUser = userProfile && ['admin', 'owner', 'manager'].includes(userProfile.role);

    useEffect(() => {
      if (!isAuthLoading && !user) {
        router.push('/login');
      }
    }, [user, isAuthLoading, router]);

    useEffect(() => {
        const shiftsQuery = query(collection(db, 'shifts'));

        const unsubShifts = onSnapshot(shiftsQuery, (snapshot) => {
            const fetchedShifts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Shift));
            setAllShifts(fetchedShifts);
            setLoading(false);
            setError(null);
        }, (err) => {
            console.error("Error fetching shifts:", err);
            setError("Could not fetch shift data.");
            setLoading(false);
        });
        
        // This is a privileged operation. We will only perform it if the user is an admin/owner/manager.
        // For regular users, we will fetch user data on demand.
        if (isPrivilegedUser) {
            const usersQuery = query(collection(db, 'users'));
            const unsubUsers = onSnapshot(usersQuery, (snapshot) => {
                const fetchedUsers = snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile));
                setUsers(fetchedUsers);
            }, (err) => {
                console.error("Error fetching users:", err);
                // Non-critical error, as we can fetch names from shifts.
                // We don't set a blocking error message here.
            });
            return () => {
              unsubShifts();
              unsubUsers();
            };
        } else {
            return () => unsubShifts();
        }
    }, [isPrivilegedUser]);

    const naturalSort = (a: string, b: string) => {
        const aParts = a.match(/(\d+)|(\D+)/g) || [];
        const bParts = b.match(/(\d+)|(\D+)/g) || [];
        
        for (let i = 0; i < Math.min(aParts.length, bParts.length); i++) {
            const partA = aParts[i];
            const partB = bParts[i];

            if (isNaN(parseInt(partA)) || isNaN(parseInt(partB))) {
                if (partA < partB) return -1;
                if (partA > partB) return 1;
            } else {
                const numA = parseInt(partA);
                const numB = parseInt(partB);
                if (numA < numB) return -1;
                if (numA > numB) return 1;
            }
        }
        return a.length - b.length;
    };

    const availableAddresses = useMemo(() => {
        if (loading) return [];
        
        let relevantShifts = allShifts;
        // For standard users, only show addresses for projects they are assigned to.
        if (!isPrivilegedUser && user) {
            const userShiftAddresses = new Set(allShifts.filter(shift => shift.userId === user.uid).map(s => s.address));
            relevantShifts = allShifts.filter(shift => userShiftAddresses.has(shift.address));
        }

        const uniqueAddresses = Array.from(new Set(relevantShifts.map(shift => shift.address)));
        
        const filtered = uniqueAddresses.filter(address => 
            address.toLowerCase().includes(addressSearchTerm.toLowerCase())
        );

        return filtered.sort(naturalSort);
    }, [allShifts, loading, addressSearchTerm, user, isPrivilegedUser]);

    const userNameMap = useMemo(() => new Map(users.map(u => [u.uid, u.name])), [users]);

    const { lastWeekShifts, thisWeekShifts, nextWeekShifts, week3Shifts, week4Shifts } = useMemo(() => {
        const today = startOfToday();
        
        if (!selectedAddress) {
            return { lastWeekShifts: {}, thisWeekShifts: {}, nextWeekShifts: {}, week3Shifts: {}, week4Shifts: {} };
        }

        const relevantShifts = allShifts.filter(s => s.address === selectedAddress);
        
        const groupShifts = (weekStart: Date) => {
            const weekShifts = relevantShifts.filter(s => isSameWeek(getCorrectedLocalDate(s.date), weekStart, { weekStartsOn: 1 }));
            const grouped: { [key: string]: Shift[] } = {
                'Monday': [], 'Tuesday': [], 'Wednesday': [], 'Thursday': [], 'Friday': [], 'Saturday': [], 'Sunday': [],
            };
            weekShifts.forEach(shift => {
                const dayName = format(getCorrectedLocalDate(shift.date), 'eeee');
                if (grouped[dayName]) {
                    grouped[dayName].push(shift);
                }
            });
            return grouped;
        }

        const startOfThisWeek = startOfWeek(today, { weekStartsOn: 1 });
        const startOfNextWeek = addDays(startOfThisWeek, 7);
        const startOfLastWeek = subDays(startOfThisWeek, 7);
        const startOfWeek3 = addDays(startOfThisWeek, 14);
        const startOfWeek4 = addDays(startOfThisWeek, 21);

        return {
            lastWeekShifts: groupShifts(startOfLastWeek),
            thisWeekShifts: groupShifts(startOfThisWeek),
            nextWeekShifts: groupShifts(startOfNextWeek),
            week3Shifts: groupShifts(startOfWeek3),
            week4Shifts: groupShifts(startOfWeek4),
        };
    }, [allShifts, selectedAddress]);

    const handleDownloadPdf = async (weeks: ('last'|'this'|'next'|'w3'|'w4')[]) => {
        if (!selectedAddress) {
            toast({
                variant: 'destructive',
                title: 'No Property Selected',
                description: 'Please select a property to generate a PDF schedule.',
            });
            return;
        }

        const { default: jsPDF } = await import('jspdf');
        const { default: autoTable } = await import('jspdf-autotable');

        const doc = new jsPDF();
        const generationDate = new Date();
        const pageMargin = 14;
        const pageWidth = doc.internal.pageSize.width;
        const usableWidth = pageWidth - (pageMargin * 2);

        doc.setFontSize(16);
        doc.text(`Work Schedule for:`, pageMargin, 22);

        doc.setFontSize(12);
        const addressLines = doc.splitTextToSize(selectedAddress, usableWidth);
        doc.text(addressLines, pageMargin, 28);
        
        let finalY = 28 + (addressLines.length * 7);

        doc.setFontSize(11);
        doc.setTextColor(100);
        doc.text(`Generated on: ${format(generationDate, 'PPP p')}`, pageMargin, finalY);
        finalY += 10;
        
        const weekData = {
            'last': { title: 'Last Week', shifts: lastWeekShifts },
            'this': { title: 'This Week', shifts: thisWeekShifts },
            'next': { title: 'Next Week', shifts: nextWeekShifts },
            'w3': { title: 'Week 3', shifts: week3Shifts },
            'w4': { title: 'Week 4', shifts: week4Shifts },
        };
        
        let hasAnyShifts = false;

        const generateTableForWeek = (title: string, shiftsForPeriod: { [key: string]: Shift[] }) => {
            const allWeekShifts = Object.values(shiftsForPeriod).flat();
            if (allWeekShifts.length === 0) return;

            hasAnyShifts = true;

            doc.setFontSize(16);
            doc.text(title, pageMargin, finalY);
            finalY += 10;
            
            allWeekShifts.sort((a,b) => getCorrectedLocalDate(a.date).getTime() - getCorrectedLocalDate(b.date).getTime());

            const head = [['Date', 'Operative', 'Task', 'Type']];
            const body = allWeekShifts.map(shift => [
                format(getCorrectedLocalDate(shift.date), 'EEE, dd MMM'),
                shift.userName || userNameMap.get(shift.userId) || 'Unknown',
                shift.task,
                shift.type === 'all-day' ? 'All Day' : shift.type.toUpperCase()
            ]);

            autoTable(doc, {
                head,
                body,
                startY: finalY,
                headStyles: { fillColor: [6, 95, 212] },
                didDrawPage: (data) => {
                    finalY = data.cursor?.y || 0;
                }
            });
            finalY = (doc as any).lastAutoTable.finalY + 15;
        }
        
        weeks.forEach(weekKey => {
            const data = weekData[weekKey];
            generateTableForWeek(data.title, data.shifts);
        });

        if (!hasAnyShifts) {
            doc.text("No shifts scheduled for the selected period(s).", 14, finalY);
        }

        doc.save(`schedule_${selectedAddress.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`);
    };

    if (isAuthLoading || isProfileLoading || !user) {
        return (
          <div className="flex min-h-screen w-full flex-col items-center justify-center">
            <Spinner size="lg" />
          </div>
        );
    }
    
    return (
        <div className="flex min-h-screen w-full flex-col">
            <Header />
            <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
                <Card>
                    <CardHeader>
                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                            <div>
                                <CardTitle>Site Schedule View</CardTitle>
                                <CardDescription>Select a property to see all scheduled work.</CardDescription>
                            </div>
                        </div>
                        <div className="pt-4 flex flex-col sm:flex-row gap-4">
                             <div className="relative flex-grow">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input 
                                    placeholder="Search addresses..."
                                    value={addressSearchTerm}
                                    onChange={(e) => setAddressSearchTerm(e.target.value)}
                                    className="w-full sm:w-[400px] pl-10"
                                />
                            </div>
                             <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="outline" disabled={!selectedAddress || loading}>
                                        <Download className="mr-2 h-4 w-4" />
                                        Download PDF
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent>
                                    <DropdownMenuItem onSelect={() => handleDownloadPdf(['this'])}>This Week</DropdownMenuItem>
                                    <DropdownMenuItem onSelect={() => handleDownloadPdf(['this', 'next'])}>This & Next Week</DropdownMenuItem>
                                    <DropdownMenuItem onSelect={() => handleDownloadPdf(['last', 'this', 'next', 'w3', 'w4'])}>All Weeks</DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                         <div className="pt-2">
                            <Select onValueChange={setSelectedAddress} value={selectedAddress || ''}>
                                <SelectTrigger className="w-full sm:w-[400px]">
                                    <SelectValue placeholder="Select a property address..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {availableAddresses.length > 0 ? (
                                        availableAddresses.map(address => (
                                            <SelectItem key={address} value={address}>
                                                {address}
                                            </SelectItem>
                                        ))
                                    ) : (
                                        <div className="p-4 text-center text-sm text-muted-foreground">
                                            No matching addresses found.
                                        </div>
                                    )}
                                </SelectContent>
                            </Select>
                        </div>
                    </CardHeader>
                    <CardContent>
                        {error && (
                            <Alert variant="destructive">
                                <Terminal className="h-4 w-4" />
                                <AlertTitle>Error Loading Data</AlertTitle>
                                <AlertDescription>{error}</AlertDescription>
                            </Alert>
                        )}
                        {!selectedAddress && !error ? (
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
                        ) : (
                            <Tabs defaultValue="this-week">
                                <div className="flex flex-col space-y-2">
                                    <TabsList className="grid grid-cols-3">
                                        <TabsTrigger value="last-week">Last Week</TabsTrigger>
                                        <TabsTrigger value="this-week">This Week</TabsTrigger>
                                        <TabsTrigger value="next-week">Next Week</TabsTrigger>
                                    </TabsList>
                                     <TabsList className="grid grid-cols-2">
                                        <TabsTrigger value="week-3">Week 3</TabsTrigger>
                                        <TabsTrigger value="week-4">Week 4</TabsTrigger>
                                    </TabsList>
                                </div>
                                <TabsContent value="last-week" className="mt-4">
                                    <WeekScheduleView shifts={lastWeekShifts} weekName="Last Week" userNameMap={userNameMap} />
                                </TabsContent>
                                <TabsContent value="this-week" className="mt-4">
                                    <WeekScheduleView shifts={thisWeekShifts} weekName="This Week" userNameMap={userNameMap} />
                                </TabsContent>
                                <TabsContent value="next-week" className="mt-4">
                                     <WeekScheduleView shifts={nextWeekShifts} weekName="Next Week" userNameMap={userNameMap} />
                                </TabsContent>
                                <TabsContent value="week-3" className="mt-4">
                                     <WeekScheduleView shifts={week3Shifts} weekName="Week 3" userNameMap={userNameMap} />
                                </TabsContent>
                                <TabsContent value="week-4" className="mt-4">
                                     <WeekScheduleView shifts={week4Shifts} weekName="Week 4" userNameMap={userNameMap} />
                                </TabsContent>
                            </Tabs>
                        )}
                    </CardContent>
                </Card>
            </main>
        </div>
    );
}
