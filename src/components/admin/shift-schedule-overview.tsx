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

  const renderWeekSchedule = (weekShifts: Shift[], usersForView: UserProfile[]) => {
    if (loading) {
      return (
        <div className="space-y-8 mt-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i}>
              <Skeleton className="h-7 w-48 mb-4" />
              <div className="border rounded-lg overflow-hidden">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-16 w-full border-t" />
                <Skeleton className="h-16 w-full border-t" />
              </div>
            </div>
          ))}
        </div>
      );
    }
    
    const activeUserIdsThisWeek = new Set(weekShifts.map(s => s.userId));
    const activeUsers = usersForView.filter(u => activeUserIdsThisWeek.has(u.uid));

    if (activeUsers.length === 0) {
      return (
        <div className="h-24 text-center flex items-center justify-center text-muted-foreground mt-4 border border-dashed rounded-lg">
          No shifts scheduled for this week.
        </div>
      );
    }
    
    const shiftsByUser = new Map<string, Shift[]>();
    weekShifts.forEach(shift => {
        if (!shiftsByUser.has(shift.userId)) {
            shiftsByUser.set(shift.userId, []);
        }
        shiftsByUser.get(shift.userId)!.push(shift);
    });

    shiftsByUser.forEach(userShifts => {
        userShifts.sort((a, b) => getCorrectedLocalDate(a.date).getTime() - getCorrectedLocalDate(b.date).getTime());
    });

    return (
      <div className="space-y-8 mt-4">
        {activeUsers.map(user => {
            const userShifts = shiftsByUser.get(user.uid) || [];
            if (userShifts.length === 0) return null;

            return (
                <div key={user.uid}>
                    <h3 className="text-xl font-semibold mb-3">{user.name}</h3>
                    <Card>
                        <CardContent className="p-0">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-[180px]">Date</TableHead>
                                        <TableHead>Task</TableHead>
                                        <TableHead>Address</TableHead>
                                        <TableHead className="text-right w-[110px]">Type</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {userShifts.map(shift => (
                                        <TableRow key={shift.id}>
                                            <TableCell className="font-medium">{format(getCorrectedLocalDate(shift.date), 'eeee, MMM d')}</TableCell>
                                            <TableCell>{shift.task}</TableCell>
                                            <TableCell className="text-muted-foreground">{shift.address}</TableCell>
                                            <TableCell className="text-right">
                                                <Badge
                                                    variant={shift.type === 'am' ? 'default' : shift.type === 'pm' ? 'secondary' : 'outline'}
                                                    className="capitalize text-xs"
                                                >
                                                    {shift.type === 'all-day' ? 'All Day' : shift.type.toUpperCase()}
                                                </Badge>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </div>
            )
        })}
      </div>
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
        <CardDescription>A list of all upcoming shifts for the team, grouped by operative. This list updates automatically.</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="this-week">
          <TabsList>
            <TabsTrigger value="this-week">This Week</TabsTrigger>
            <TabsTrigger value="next-week">Next Week</TabsTrigger>
          </TabsList>
          <TabsContent value="this-week" className="mt-0">
            {renderWeekSchedule(thisWeekShifts, users)}
          </TabsContent>
          <TabsContent value="next-week" className="mt-0">
             {renderWeekSchedule(nextWeekShifts, users)}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
