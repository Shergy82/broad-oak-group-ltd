'use client';

import { useEffect, useState, useMemo } from 'react';
import { collection, query, where, getDocs, Timestamp } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '@/lib/firebase';
import { useAuth } from '@/hooks/use-auth';
import { ShiftCard } from '@/components/dashboard/shift-card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { startOfWeek, endOfWeek, startOfToday, isWithinInterval, addWeeks, format, isToday } from 'date-fns';
import type { Shift } from '@/types';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Clock, Sunrise, Sunset, Terminal } from 'lucide-react';
import { mockShifts } from '@/lib/mock-data';

export default function Dashboard() {
  const { user } = useAuth();
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchShifts() {
      if (!isFirebaseConfigured || !db || !user) {
        setShifts(mockShifts);
        setLoading(false);
        return;
      }

      try {
        const shiftsCollection = collection(db, 'shifts');
        const q = query(shiftsCollection, where('userId', '==', user.uid));
        const querySnapshot = await getDocs(q);
        const fetchedShifts: Shift[] = [];
        querySnapshot.forEach((doc) => {
          fetchedShifts.push({ id: doc.id, ...doc.data() } as Shift);
        });
        
        if (fetchedShifts.length === 0) {
            setShifts(mockShifts);
        } else {
            setShifts(fetchedShifts.sort((a, b) => a.date.toMillis() - b.date.toMillis()));
        }
      } catch (e: any) {
        console.error("Error fetching shifts: ", e);
        let errorMessage = 'Failed to fetch shifts. Please try again later.';
        if (e.code === 'permission-denied') {
          errorMessage = "You don't have permission to view shifts. Please check your Firestore security rules in the Firebase Console.";
        } else if (e.code === 'failed-precondition') {
            errorMessage = 'Could not fetch shifts. This is likely due to a missing database index. Please check the browser console for a link to create the required index in Firebase.';
        }
        setError(errorMessage);
      } finally {
        setLoading(false);
      }
    }

    fetchShifts();
  }, [user]);

  const { 
    todayAmShifts,
    todayPmShifts,
    todayAllDayShifts,
    thisWeekShifts, 
    nextWeekShifts 
  } = useMemo(() => {
    const getCorrectedLocalDate = (date: Timestamp) => {
      const utcDate = date.toDate();
      // Correct for timezone differences by parsing the UTC date string
      const dateString = utcDate.toISOString().substring(0, 10); // "YYYY-MM-DD"
      return new Date(`${dateString}T00:00:00`);
    };

    const today = startOfToday();
    const startOfCurrentWeek = startOfWeek(today, { weekStartsOn: 1 });
    const endOfCurrentWeek = endOfWeek(today, { weekStartsOn: 1 });
    const startOfNextWeek = addWeeks(startOfCurrentWeek, 1);
    const endOfNextWeek = addWeeks(endOfCurrentWeek, 1);

    const groupShiftsByDay = (weekShifts: Shift[]) => {
      const grouped: { [key: string]: Shift[] } = {};
      weekShifts.forEach(shift => {
        const dayName = format(getCorrectedLocalDate(shift.date), 'eeee');
        if (!grouped[dayName]) {
          grouped[dayName] = [];
        }
        grouped[dayName].push(shift);
      });
      return grouped;
    };

    const todayShifts = shifts.filter(s => isToday(getCorrectedLocalDate(s.date)));
    const todayAmShifts = todayShifts.filter(s => s.type === 'am');
    const todayPmShifts = todayShifts.filter(s => s.type === 'pm');
    const todayAllDayShifts = todayShifts.filter(s => s.type === 'all-day');

    const allThisWeekShifts = shifts.filter(s => isWithinInterval(getCorrectedLocalDate(s.date), { start: startOfCurrentWeek, end: endOfCurrentWeek }));
    const allNextWeekShifts = shifts.filter(s => isWithinInterval(getCorrectedLocalDate(s.date), { start: startOfNextWeek, end: endOfNextWeek }));

    return {
      todayAmShifts,
      todayPmShifts,
      todayAllDayShifts,
      thisWeekShifts: groupShiftsByDay(allThisWeekShifts),
      nextWeekShifts: groupShiftsByDay(allNextWeekShifts),
    };
  }, [shifts]);

  const renderWeekView = (groupedShifts: { [key: string]: Shift[] }) => {
    const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    const weekends = ['Saturday', 'Sunday'];
    const allDays = [...weekdays, ...weekends];
    
    const hasShiftsThisWeek = Object.keys(groupedShifts).length > 0;

    if (loading) {
        return (
            <div className="space-y-6">
                {weekdays.map((day) => (
                    <Card key={day}>
                        <CardHeader>
                            <CardTitle>{day}</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <Skeleton className="h-32 w-full" />
                        </CardContent>
                    </Card>
                ))}
            </div>
        )
    }

    if (!hasShiftsThisWeek) {
        return <p className="text-muted-foreground mt-4 text-center">No shifts scheduled for this week.</p>;
    }

    return (
        <div className="space-y-6">
            {allDays.map(day => {
                const shiftsForDay = groupedShifts[day];
                if (!shiftsForDay || shiftsForDay.length === 0) {
                    return null;
                }

                const amShifts = shiftsForDay.filter(s => s.type === 'am');
                const pmShifts = shiftsForDay.filter(s => s.type === 'pm');
                const allDayShifts = shiftsForDay.filter(s => s.type === 'all-day');

                return (
                    <Card key={day}>
                        <CardHeader>
                            <CardTitle>{day}</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {allDayShifts.length > 0 && (
                                <div>
                                    <h4 className="text-md font-semibold mb-3 flex items-center text-indigo-600 dark:text-indigo-400"><Clock className="mr-2 h-4 w-4" /> All Day</h4>
                                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                                        {allDayShifts.map(shift => <ShiftCard key={shift.id} shift={shift} />)}
                                    </div>
                                </div>
                            )}
                            
                            {(amShifts.length > 0 || pmShifts.length > 0) && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 pt-2">
                                     <div className="space-y-4">
                                        <h4 className="text-md font-semibold flex items-center text-sky-600 dark:text-sky-400"><Sunrise className="mr-2 h-4 w-4" /> AM</h4>
                                        {amShifts.length > 0 
                                            ? amShifts.map(shift => <ShiftCard key={shift.id} shift={shift} />) 
                                            : <p className="text-muted-foreground text-xs p-4 text-center border border-dashed rounded-lg">No AM shifts.</p>}
                                    </div>
                                     <div className="space-y-4">
                                        <h4 className="text-md font-semibold flex items-center text-orange-600 dark:text-orange-400"><Sunset className="mr-2 h-4 w-4" /> PM</h4>
                                        {pmShifts.length > 0 
                                            ? pmShifts.map(shift => <ShiftCard key={shift.id} shift={shift} />) 
                                            : <p className="text-muted-foreground text-xs p-4 text-center border border-dashed rounded-lg">No PM shifts.</p>}
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                );
            })}
        </div>
    );
  };
  
  if (error) {
    return (
      <Alert variant="destructive">
        <Terminal className="h-4 w-4" />
        <AlertTitle>Error Fetching Data</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }

  return (
    <Tabs defaultValue="today" className="w-full">
      <div className="flex items-center">
        <TabsList>
          <TabsTrigger value="today">Today</TabsTrigger>
          <TabsTrigger value="this-week">This Week</TabsTrigger>
          <TabsTrigger value="next-week">Next Week</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="today">
        {loading ? (
           <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-32 w-full rounded-lg" />
            ))}
           </div>
        ) : todayAmShifts.length === 0 && todayPmShifts.length === 0 && todayAllDayShifts.length === 0 ? (
          <p className="text-muted-foreground mt-4 text-center col-span-full">No shifts scheduled for today.</p>
        ) : (
          <div className="space-y-6">
            {todayAllDayShifts.length > 0 && (
                <Card>
                    <CardHeader><CardTitle className="flex items-center text-indigo-600 dark:text-indigo-400"><Clock className="mr-2 h-5 w-5" /> All Day</CardTitle></CardHeader>
                    <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {todayAllDayShifts.map(shift => <ShiftCard key={shift.id} shift={shift} />)}
                    </CardContent>
                </Card>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                    <h3 className="text-xl font-semibold text-sky-600 dark:text-sky-400 flex items-center"><Sunrise className="mr-2 h-5 w-5" /> AM Shifts</h3>
                    {todayAmShifts.length > 0 
                        ? todayAmShifts.map(shift => <ShiftCard key={shift.id} shift={shift} />)
                        : <p className="text-muted-foreground text-sm p-4 text-center border border-dashed rounded-lg">No AM shifts scheduled.</p>}
                </div>
                <div className="space-y-4">
                    <h3 className="text-xl font-semibold text-orange-600 dark:text-orange-400 flex items-center"><Sunset className="mr-2 h-5 w-5" /> PM Shifts</h3>
                    {todayPmShifts.length > 0
                        ? todayPmShifts.map(shift => <ShiftCard key={shift.id} shift={shift} />)
                        : <p className="text-muted-foreground text-sm p-4 text-center border border-dashed rounded-lg">No PM shifts scheduled.</p>}
                </div>
            </div>
          </div>
        )}
      </TabsContent>
      <TabsContent value="this-week">
        {renderWeekView(thisWeekShifts)}
      </TabsContent>
      <TabsContent value="next-week">
        {renderWeekView(nextWeekShifts)}
      </TabsContent>
    </Tabs>
  );
}
