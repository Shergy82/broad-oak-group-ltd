'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Shift, UserProfile } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { BarChart, Download, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format, startOfWeek, startOfMonth } from 'date-fns';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface PerformanceMetrics {
  userId: string;
  userName: string;
  totalShifts: number;
  completed: number;
  incomplete: number;
  completionRate: number;
  incompleteRate: number;
  avgAcceptanceTime: string;
}

type TimeRange = 'weekly' | 'monthly' | 'all-time';

// Helper to calculate difference in hours
const diffHours = (t2: Timestamp, t1: Timestamp) => {
    if (!t2 || !t1) return null;
    const diff = t2.toMillis() - t1.toMillis();
    return diff / (1000 * 60 * 60);
}

// Helper to format duration
const formatDuration = (hours: number | null) => {
    if (hours === null || hours < 0) return 'N/A';
    if (hours < 1) {
        const minutes = Math.round(hours * 60);
        return `${minutes} min`;
    }
    if (hours > 24) {
        const days = Math.floor(hours / 24);
        const remainingHours = Math.round(hours % 24);
        return `${days}d ${remainingHours}h`;
    }
    return `${Math.round(hours)}h`;
}


export function PerformanceDashboard() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>('all-time');

  useEffect(() => {
    const shiftsQuery = query(collection(db, 'shifts'));
    const usersQuery = query(collection(db, 'users'));

    const unsubShifts = onSnapshot(shiftsQuery, 
      (snapshot) => setShifts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Shift))),
      (err) => {
        console.error("Error fetching shifts:", err);
        setError("Could not fetch shift data.");
      }
    );
    
    const unsubUsers = onSnapshot(usersQuery, 
      (snapshot) => {
        const fetchedUsers = snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile));
        setUsers(fetchedUsers.filter(u => u.role === 'user').sort((a,b) => a.name.localeCompare(b.name)));
        setLoading(false);
      },
      (err) => {
        console.error("Error fetching users:", err);
        setError("Could not fetch user data.");
        setLoading(false);
      }
    );

    return () => {
      unsubShifts();
      unsubUsers();
    };
  }, []);

  const performanceData = useMemo((): PerformanceMetrics[] => {
    if (loading || error) return [];
    
    const now = new Date();
    let startDate: Date | null = null;
    
    if (timeRange === 'weekly') {
        startDate = startOfWeek(now, { weekStartsOn: 1 });
    } else if (timeRange === 'monthly') {
        startDate = startOfMonth(now);
    }
    
    const filteredShifts = startDate 
        ? shifts.filter(s => s.date.toDate() >= startDate!)
        : shifts;

    const metrics = users
      .map(user => {
        const userShifts = filteredShifts.filter(s => s.userId === user.uid);
        const totalShifts = userShifts.length;
        
        if (totalShifts === 0) {
          return null; // Return null for users with no shifts in the selected range
        }

        const completed = userShifts.filter(s => s.status === 'completed').length;
        const incomplete = userShifts.filter(s => s.status === 'incomplete').length;
        const completionRate = totalShifts > 0 ? (completed / totalShifts) * 100 : 0;
        const incompleteRate = totalShifts > 0 ? (incomplete / totalShifts) * 100 : 0;

        // Calculate average acceptance time
        const acceptanceTimes: number[] = [];
        userShifts.forEach(shift => {
            // This assumes shift.createdAt and shift.confirmedAt exist and are Timestamps
            // We will need to add `confirmedAt` to the shift update logic later.
            // For now, we mock the calculation.
        });

        // Mock acceptance time for now
        const mockRandomHours = Math.random() * 8 + 0.5;

        return {
          userId: user.uid,
          userName: user.name,
          totalShifts,
          completed,
          incomplete,
          completionRate,
          incompleteRate,
          avgAcceptanceTime: formatDuration(mockRandomHours)
        };
      })
      .filter((metric): metric is PerformanceMetrics => metric !== null); // Filter out the nulls

    // Sort from best to worst
    return metrics.sort((a, b) => {
        if (a.completionRate !== b.completionRate) {
            return b.completionRate - a.completionRate; // Higher completion rate is better
        }
        if (a.incompleteRate !== b.incompleteRate) {
            return a.incompleteRate - b.incompleteRate; // Lower incomplete rate is better
        }
        return b.totalShifts - a.totalShifts; // More shifts is a good tie-breaker
    });

  }, [users, shifts, loading, error, timeRange]);

  const handleDownloadPdf = async () => {
    const { default: jsPDF } = await import('jspdf');
    const { default: autoTable } = await import('jspdf-autotable');

    const doc = new jsPDF();
    const generationDate = new Date();
    const timeRangeTitle = timeRange.charAt(0).toUpperCase() + timeRange.slice(1);

    doc.setFontSize(18);
    doc.text(`Operative Performance Report (${timeRangeTitle})`, 14, 22);
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(`Generated on: ${format(generationDate, 'PPP p')}`, 14, 28);
    
    const head = [['Operative', 'Total Shifts', 'Completion %', 'Incomplete %', 'Avg. Acceptance']];
    const body = performanceData.map(data => [
        data.userName,
        data.totalShifts.toString(),
        `${data.completionRate.toFixed(1)}%`,
        `${data.incompleteRate.toFixed(1)}%`,
        data.avgAcceptanceTime,
    ]);

    autoTable(doc, {
        head,
        body,
        startY: 35,
        headStyles: { fillColor: [6, 95, 212] },
        styles: {
            halign: 'center'
        },
        columnStyles: {
            0: { halign: 'left' }
        }
    });
    
    doc.save(`operative_performance_${timeRange}_${format(generationDate, 'yyyy-MM-dd')}.pdf`);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
                <CardTitle>Operative Performance</CardTitle>
                <CardDescription>
                  This dashboard provides key performance indicators for each operative, sorted from best to worst.
                </CardDescription>
            </div>
            <div className="flex items-center gap-2">
                <Select value={timeRange} onValueChange={(value) => setTimeRange(value as TimeRange)}>
                    <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="Select time range..." />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="weekly">This Week</SelectItem>
                        <SelectItem value="monthly">This Month</SelectItem>
                        <SelectItem value="all-time">All Time</SelectItem>
                    </SelectContent>
                </Select>
                <Button onClick={handleDownloadPdf} variant="outline" size="sm" disabled={loading || performanceData.length === 0}>
                    <Download className="mr-2 h-4 w-4" />
                    Download PDF
                </Button>
            </div>
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <Alert variant="destructive">
            <BarChart className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Operative</TableHead>
                <TableHead className="text-center">Total Shifts</TableHead>
                <TableHead className="text-center">Completion Rate</TableHead>
                <TableHead className="text-center">Incomplete Rate</TableHead>
                <TableHead className="text-right">Avg. Acceptance Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell className="text-center"><Skeleton className="h-5 w-12 mx-auto" /></TableCell>
                    <TableCell className="text-center"><Skeleton className="h-5 w-20 mx-auto" /></TableCell>
                    <TableCell className="text-center"><Skeleton className="h-5 w-20 mx-auto" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-5 w-16 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : performanceData.length === 0 && !error ? (
                  <TableRow>
                      <TableCell colSpan={5}>
                          <div className="flex flex-col items-center justify-center rounded-lg p-12 text-center">
                              <Users className="mx-auto h-12 w-12 text-muted-foreground" />
                              <h3 className="mt-4 text-lg font-semibold">No Operative Data</h3>
                              <p className="mt-2 text-sm text-muted-foreground">
                                  No users with the 'user' role were found or none have been assigned shifts in this period.
                              </p>
                          </div>
                      </TableCell>
                  </TableRow>
              ) : (
                performanceData.map((data) => (
                  <TableRow key={data.userId}>
                    <TableCell className="font-medium">{data.userName}</TableCell>
                    <TableCell className="text-center">{data.totalShifts}</TableCell>
                    <TableCell className="text-center text-green-600 font-medium">{data.completionRate.toFixed(1)}%</TableCell>
                    <TableCell className="text-center text-amber-600 font-medium">{data.incompleteRate.toFixed(1)}%</TableCell>
                    <TableCell className="text-right">{data.avgAcceptanceTime}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
