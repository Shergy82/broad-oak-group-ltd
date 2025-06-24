'use client';

import { useEffect, useState, useMemo } from 'react';
import { collection, query, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Shift, UserProfile } from '@/types';
import { format, isSameWeek, addDays } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Terminal } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export function ShiftScheduleOverview() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!db) {
      setLoading(false);
      setError("Firebase is not configured.");
      return;
    }

    const usersQuery = query(collection(db, 'users'));
    const unsubscribeUsers = onSnapshot(usersQuery, (snapshot) => {
      const fetchedUsers = snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile));
      fetchedUsers.sort((a, b) => a.name.localeCompare(b.name));
      setUsers(fetchedUsers);
    }, (err) => {
      console.error("Error fetching users: ", err);
      setError("Could not fetch user data.");
      setLoading(false);
    });

    const shiftsQuery = query(collection(db, 'shifts'));
    const unsubscribeShifts = onSnapshot(shiftsQuery, (snapshot) => {
      const fetchedShifts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Shift));
      setShifts(fetchedShifts);
      setLoading(false);
    }, (err) => {
      console.error("Error fetching shifts: ", err);
      let errorMessage = 'Failed to fetch schedule. Please try again later.';
      if (err.code === 'permission-denied') {
        errorMessage = "You don't have permission to view the full schedule. This is because your project's Firestore security rules are too restrictive. Please open the `firestore.rules` file in your project, copy its contents, and paste them into the 'Rules' tab of your Cloud Firestore database in the Firebase Console.";
      } else if (err.code === 'failed-precondition') {
        errorMessage = 'Could not fetch schedule. This is likely due to a missing database index. Please check the browser console for a link to create the required index in Firebase.';
      }
      setError(errorMessage);
      setLoading(false);
    });

    return () => {
      unsubscribeUsers();
      unsubscribeShifts();
    };
  }, []);

  const getCorrectedLocalDate = (date: { toDate: () => Date }) => {
    const d = date.toDate();
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  };

  const { thisWeekShifts, nextWeekShifts } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const nextWeekDate = addDays(today, 7);

    const thisWeekShifts = shifts.filter(s => 
        isSameWeek(getCorrectedLocalDate(s.date), today, { weekStartsOn: 1 })
    );

    const nextWeekShifts = shifts.filter(s => 
        isSameWeek(getCorrectedLocalDate(s.date), nextWeekDate, { weekStartsOn: 1 })
    );

    return { thisWeekShifts, nextWeekShifts };
  }, [shifts]);

  const renderWeekGrid = (weekShifts: Shift[], usersForGrid: UserProfile[]) => {
    if (loading) {
      return (
        <div className="space-y-2 mt-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex gap-2">
                <Skeleton className="h-24 w-32" />
                {Array.from({ length: 7 }).map((_, j) => (
                    <Skeleton key={j} className="h-24 flex-1" />
                ))}
            </div>
          ))}
        </div>
      );
    }
    
    const activeUserIdsThisWeek = new Set(weekShifts.map(s => s.userId));
    const activeUsers = usersForGrid.filter(u => activeUserIdsThisWeek.has(u.uid));

    if (activeUsers.length === 0) {
      return (
        <div className="h-24 text-center flex items-center justify-center text-muted-foreground mt-4 border border-dashed rounded-lg">
          No shifts scheduled for this week.
        </div>
      );
    }
    
    const scheduleMap = new Map<string, Map<string, Shift[]>>();
    activeUsers.forEach(u => scheduleMap.set(u.uid, new Map()));
    
    weekShifts.forEach(shift => {
      if (scheduleMap.has(shift.userId)) {
        const dayName = format(getCorrectedLocalDate(shift.date), 'eee');
        const userShifts = scheduleMap.get(shift.userId)!;
        if (!userShifts.has(dayName)) {
            userShifts.set(dayName, []);
        }
        userShifts.get(dayName)!.push(shift);
      }
    });

    const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    const weekends = ['Sat', 'Sun'];
    const allDays = [...weekdays, ...weekends];
    
    const hasWorkOnWeekend = weekends.some(day => 
      activeUsers.some(user => scheduleMap.get(user.uid)?.has(day))
    );
    const daysToDisplay = hasWorkOnWeekend ? allDays : weekdays;

    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[120px] sticky left-0 bg-card z-10 shadow-sm">Operative</TableHead>
            {daysToDisplay.map(day => <TableHead key={day} className="text-center px-1">{day}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {activeUsers.map(user => (
              <TableRow key={user.uid}>
                <TableCell className="font-medium sticky left-0 bg-card z-10 shadow-sm">{user.name}</TableCell>
                {daysToDisplay.map(day => {
                  const dayShifts = scheduleMap.get(user.uid)?.get(day) || [];
                  dayShifts.sort((a, b) => {
                      const order = { 'all-day': 0, 'am': 1, 'pm': 2 };
                      return (order[a.type] ?? 99) - (order[b.type] ?? 99);
                  });

                  return (
                    <TableCell key={day} className="align-top p-1">
                      {dayShifts.length > 0 && (
                        <div className="space-y-1">
                          {dayShifts.map(shift => (
                            <div key={shift.id} className="text-xs p-1.5 rounded-md bg-muted/50 border border-muted-foreground/20">
                              <div className="flex justify-between items-start gap-1">
                                <p className="font-semibold leading-tight break-words">{shift.task}</p>
                                <Badge 
                                  variant={shift.type === 'am' ? 'default' : shift.type === 'pm' ? 'secondary' : 'outline'} 
                                  className="text-[10px] py-0 px-1.5 h-auto shrink-0"
                                >
                                  {shift.type === 'all-day' ? 'All' : shift.type.toUpperCase()}
                                </Badge>
                              </div>
                              <p className="text-muted-foreground text-[11px] truncate pt-0.5">{shift.address}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  };
  
  if (error) {
      return (
          <Alert variant="destructive">
              <Terminal className="h-4 w-4" />
              <AlertTitle>Error Loading Schedule</AlertTitle>
              <AlertDescription style={{ whiteSpace: 'pre-wrap' }}>{error}</AlertDescription>
          </Alert>
      )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Weekly Schedule Overview</CardTitle>
        <CardDescription>A grid view of all upcoming shifts for the team. This list updates automatically.</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="this-week">
          <TabsList>
            <TabsTrigger value="this-week">This Week</TabsTrigger>
            <TabsTrigger value="next-week">Next Week</TabsTrigger>
          </TabsList>
          <TabsContent value="this-week" className="mt-4">
            {renderWeekGrid(thisWeekShifts, users)}
          </TabsContent>
          <TabsContent value="next-week" className="mt-4">
             {renderWeekGrid(nextWeekShifts, users)}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
