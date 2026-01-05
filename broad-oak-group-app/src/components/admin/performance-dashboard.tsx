
'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Shift, UserProfile } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { BarChart, Download, Users, Percent, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface PerformanceMetrics {
  userId: string;
  userName: string;
  totalShifts: number;
  completed: number;
  incomplete: number;
  completionRate: number;
  incompleteRate: number;
}

type TimeRange = 'weekly' | 'monthly' | 'all-time';

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
    let filteredShifts: Shift[];

    if (timeRange === 'weekly') {
      const start = startOfWeek(now, { weekStartsOn: 1 });
      const end = endOfWeek(now, { weekStartsOn: 1 });
      filteredShifts = shifts.filter(s => {
          const shiftDate = s.date.toDate();
          return shiftDate >= start && shiftDate <= end;
      });
    } else { // monthly and all-time now both start from the beginning of the month
      const start = startOfMonth(now);
      const end = endOfMonth(now); // We'll filter up to the end of the current month
      filteredShifts = shifts.filter(s => {
          const shiftDate = s.date.toDate();
          return shiftDate >= start && shiftDate <= end;
      });
    }


    const metrics = users
      .map(user => {
        const userShifts = filteredShifts.filter(s => s.userId === user.uid);
        const totalShifts = userShifts.length;
        
        if (totalShifts === 0) {
          return null;
        }

        const completed = userShifts.filter(s => s.status === 'completed').length;
        const incomplete = userShifts.filter(s => s.status === 'incomplete').length;
        
        // The total number of shifts that are no longer active
        const relevantTotal = userShifts.filter(s => s.status === 'completed' || s.status === 'incomplete').length;
        
        // Calculate rate against all assigned shifts in the period, except those still pending first confirmation
        const rateCalculationTotal = userShifts.filter(s => s.status !== 'pending-confirmation').length;

        const completionRate = rateCalculationTotal > 0 ? (completed / rateCalculationTotal) * 100 : 0;
        const incompleteRate = rateCalculationTotal > 0 ? (incomplete / rateCalculationTotal) * 100 : 0;
        
        return {
          userId: user.uid,
          userName: user.name,
          totalShifts,
          completed,
          incomplete,
          completionRate,
          incompleteRate,
        };
      })
      .filter((metric): metric is PerformanceMetrics => metric !== null); 

    return metrics.sort((a, b) => {
        if (a.completionRate !== b.completionRate) {
            return b.completionRate - a.completionRate;
        }
        if (a.incompleteRate !== b.incompleteRate) {
            return a.incompleteRate - b.incompleteRate;
        }
        return b.totalShifts - a.totalShifts;
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
    
    const head = [['Operative', 'Total Shifts', 'Completion %', 'Incomplete %']];
    const body = performanceData.map(data => [
        data.userName,
        data.totalShifts.toString(),
        `${data.completionRate.toFixed(1)}%`,
        `${data.incompleteRate.toFixed(1)}%`,
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
                  Key performance indicators for each operative, sorted from best to worst.
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
        
        {loading ? (
             <div className="border rounded-lg"><Skeleton className="w-full h-48" /></div>
        ) : performanceData.length === 0 && !error ? (
            <div className="flex flex-col items-center justify-center rounded-lg p-12 text-center border border-dashed">
                <Users className="mx-auto h-12 w-12 text-muted-foreground" />
                <h3 className="mt-4 text-lg font-semibold">No Operative Data</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                    No users with the 'user' role were found or none have been assigned shifts in this period.
                </p>
            </div>
        ) : (
          <>
            {/* Desktop View */}
            <div className="border rounded-lg hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Operative</TableHead>
                    <TableHead className="text-center">Total Shifts</TableHead>
                    <TableHead className="text-center">Completion Rate</TableHead>
                    <TableHead className="text-right">Incomplete Rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {performanceData.map((data) => (
                      <TableRow key={data.userId}>
                        <TableCell className="font-medium">{data.userName}</TableCell>
                        <TableCell className="text-center">{data.totalShifts}</TableCell>
                        <TableCell className="text-center text-green-600 font-medium">{data.completionRate.toFixed(1)}%</TableCell>
                        <TableCell className="text-right text-amber-600 font-medium">{data.incompleteRate.toFixed(1)}%</TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile View */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:hidden">
              {performanceData.map((data) => (
                <Card key={data.userId}>
                  <CardHeader>
                    <CardTitle className="text-base">{data.userName}</CardTitle>
                    <CardDescription>Total Shifts: {data.totalShifts}</CardDescription>
                  </CardHeader>
                  <CardContent className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                     <div className="flex items-center gap-2">
                        <Percent className="h-4 w-4 text-muted-foreground" />
                        <div>
                            <p className="font-medium text-green-600">{data.completionRate.toFixed(1)}%</p>
                            <p className="text-muted-foreground text-xs">Complete</p>
                        </div>
                    </div>
                     <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                        <div>
                            <p className="font-medium">{data.completed}</p>
                            <p className="text-muted-foreground text-xs">Completed</p>
                        </div>
                    </div>
                     <div className="flex items-center gap-2">
                        <XCircle className="h-4 w-4 text-muted-foreground" />
                        <div>
                            <p className="font-medium">{data.incomplete}</p>
                            <p className="text-muted-foreground text-xs">Incomplete</p>
                        </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

    

    