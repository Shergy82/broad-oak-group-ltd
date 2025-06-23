'use client';

import { useEffect, useState, useMemo } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '@/lib/firebase';
import { useAuth } from '@/hooks/use-auth';
import { ShiftCard } from '@/components/dashboard/shift-card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { startOfWeek, endOfWeek, startOfToday, isWithinInterval, addWeeks, format, isToday } from 'date-fns';
import type { Shift } from '@/types';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Terminal } from 'lucide-react';

export default function Dashboard() {
  const { user } = useAuth();
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchShifts() {
      if (!isFirebaseConfigured || !db || !user) {
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
        setShifts(fetchedShifts.sort((a, b) => a.date.toMillis() - b.date.toMillis()));
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

  const { todayShifts, thisWeekShifts, nextWeekShifts } = useMemo(() => {
    const today = startOfToday();
    const startOfCurrentWeek = startOfWeek(today, { weekStartsOn: 1 });
    const endOfCurrentWeek = endOfWeek(today, { weekStartsOn: 1 });
    const startOfNextWeek = addWeeks(startOfCurrentWeek, 1);
    const endOfNextWeek = addWeeks(endOfCurrentWeek, 1);

    const groupShiftsByDay = (weekShifts: Shift[]) => {
      const grouped: { [key: string]: Shift[] } = {};
      weekShifts.forEach(shift => {
        const dayName = format(shift.date.toDate(), 'eeee'); // "Monday", "Tuesday", etc.
        if (!grouped[dayName]) {
          grouped[dayName] = [];
        }
        grouped[dayName].push(shift);
      });
      return grouped;
    };

    const todayShifts = shifts.filter(s => isToday(s.date.toDate()));
    const allThisWeekShifts = shifts.filter(s => isWithinInterval(s.date.toDate(), { start: startOfCurrentWeek, end: endOfCurrentWeek }));
    const allNextWeekShifts = shifts.filter(s => isWithinInterval(s.date.toDate(), { start: startOfNextWeek, end: endOfNextWeek }));

    return {
      todayShifts,
      thisWeekShifts: groupShiftsByDay(allThisWeekShifts),
      nextWeekShifts: groupShiftsByDay(allNextWeekShifts),
    };
  }, [shifts]);

  const renderTodayShifts = (shiftList: Shift[]) => {
    if (loading) {
      return Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-32 w-full rounded-lg" />
      ));
    }
    if (shiftList.length === 0) {
      return <p className="text-muted-foreground mt-4 text-center col-span-full">No shifts scheduled for today.</p>;
    }
    return shiftList.map(shift => <ShiftCard key={shift.id} shift={shift} />);
  };

  const renderWeekView = (groupedShifts: { [key: string]: Shift[] }) => {
    const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    const weekends = ['Saturday', 'Sunday'];
    
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
                            <Skeleton className="h-24 w-full" />
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
            {weekdays.map(day => (
                <Card key={day}>
                    <CardHeader>
                        <CardTitle>{day}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {groupedShifts[day] && groupedShifts[day].length > 0 ? (
                            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                                {groupedShifts[day].map(shift => <ShiftCard key={shift.id} shift={shift} />)}
                            </div>
                        ) : (
                            <p className="text-muted-foreground text-sm">No shifts scheduled.</p>
                        )}
                    </CardContent>
                </Card>
            ))}
            {weekends.map(day => {
                if (groupedShifts[day] && groupedShifts[day].length > 0) {
                    return (
                        <Card key={day}>
                            <CardHeader>
                                <CardTitle>{day}</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                                    {groupedShifts[day].map(shift => <ShiftCard key={shift.id} shift={shift} />)}
                                </div>
                            </CardContent>
                        </Card>
                    );
                }
                return null;
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
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {renderTodayShifts(todayShifts)}
        </div>
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
