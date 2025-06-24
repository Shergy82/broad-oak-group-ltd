'use client';

import { useEffect, useState, useMemo } from 'react';
import { collection, query, where, Timestamp, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Shift, UserProfile } from '@/types';
import { startOfWeek, endOfWeek, addWeeks, format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Terminal } from 'lucide-react';

export function ShiftScheduleOverview() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const uidToNameMap = useMemo(() => {
    return new Map(users.map(user => [user.uid, user.name]));
  }, [users]);

  useEffect(() => {
    if (!db) {
      setLoading(false);
      setError("Firebase is not configured.");
      return;
    }

    // Listener for users
    const usersQuery = query(collection(db, 'users'));
    const unsubscribeUsers = onSnapshot(usersQuery, (snapshot) => {
      const fetchedUsers = snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile));
      setUsers(fetchedUsers);
    }, (err) => {
      console.error("Error fetching users: ", err);
      setError("Could not fetch user data.");
      setLoading(false);
    });

    // Listener for shifts
    const today = new Date();
    const startOfThisWeek = startOfWeek(today, { weekStartsOn: 1 });
    const shiftsQuery = query(
      collection(db, 'shifts'),
      where('date', '>=', Timestamp.fromDate(startOfThisWeek))
    );
    const unsubscribeShifts = onSnapshot(shiftsQuery, (snapshot) => {
      const fetchedShifts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Shift));
      fetchedShifts.sort((a, b) => a.date.toMillis() - b.date.toMillis());
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

  const getCorrectedLocalDate = (date: Timestamp) => {
    const utcDate = date.toDate();
    const dateString = utcDate.toISOString().substring(0, 10); // "YYYY-MM-DD"
    return new Date(`${dateString}T00:00:00`);
  };

  const { thisWeekShifts, nextWeekShifts } = useMemo(() => {
    const today = new Date();
    const startOfCurrentWeek = startOfWeek(today, { weekStartsOn: 1 });
    const endOfCurrentWeek = endOfWeek(today, { weekStartsOn: 1 });

    const thisWeekShifts = shifts.filter(s => {
        const shiftDate = getCorrectedLocalDate(s.date);
        return shiftDate >= startOfCurrentWeek && shiftDate <= endOfCurrentWeek;
    });

    const nextWeekShifts = shifts.filter(s => {
        const shiftDate = getCorrectedLocalDate(s.date);
        const startOfNextWeek = addWeeks(startOfCurrentWeek, 1);
        const endOfNextWeek = addWeeks(endOfCurrentWeek, 1);
        return shiftDate >= startOfNextWeek && shiftDate <= endOfNextWeek;
    });

    return { thisWeekShifts, nextWeekShifts };
  }, [shifts]);

  const renderWeekView = (weekShifts: Shift[]) => {
    if (loading) {
      return (
        <TableBody>
          {Array.from({ length: 5 }).map((_, i) => (
            <TableRow key={i}>
              <TableCell><Skeleton className="h-4 w-24" /></TableCell>
              <TableCell><Skeleton className="h-4 w-24" /></TableCell>
              <TableCell><Skeleton className="h-4 w-40" /></TableCell>
              <TableCell><Skeleton className="h-4 w-48" /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      );
    }
    if (weekShifts.length === 0) {
      return (
        <TableBody>
          <TableRow>
            <TableCell colSpan={4} className="h-24 text-center">
              No shifts scheduled for this week.
            </TableCell>
          </TableRow>
        </TableBody>
      );
    }
    return (
      <TableBody>
        {weekShifts.map((shift, i) => (
          <TableRow key={shift.id} className={i % 2 === 0 ? 'bg-muted/50' : ''}>
            <TableCell className="font-medium">{format(getCorrectedLocalDate(shift.date), 'eeee, dd MMM')}</TableCell>
            <TableCell>{uidToNameMap.get(shift.userId) || shift.userId}</TableCell>
            <TableCell>{shift.address}</TableCell>
            <TableCell>{shift.task}</TableCell>
          </TableRow>
        ))}
      </TableBody>
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
        <CardDescription>A summary of all upcoming shifts for the team. This list updates automatically.</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="this-week">
          <TabsList>
            <TabsTrigger value="this-week">This Week</TabsTrigger>
            <TabsTrigger value="next-week">Next Week</TabsTrigger>
          </TabsList>
          <TabsContent value="this-week" className="mt-4">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead className="w-[180px]">Date</TableHead>
                        <TableHead className="w-[150px]">Operative</TableHead>
                        <TableHead>Address</TableHead>
                        <TableHead>Task</TableHead>
                    </TableRow>
                </TableHeader>
                {renderWeekView(thisWeekShifts)}
            </Table>
          </TabsContent>
          <TabsContent value="next-week" className="mt-4">
             <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead className="w-[180px]">Date</TableHead>
                        <TableHead className="w-[150px]">Operative</TableHead>
                        <TableHead>Address</TableHead>
                        <TableHead>Task</TableHead>
                    </TableRow>
                </TableHeader>
                {renderWeekView(nextWeekShifts)}
            </Table>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
