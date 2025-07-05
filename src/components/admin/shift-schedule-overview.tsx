'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, doc, deleteDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Shift, UserProfile } from '@/types';
import { addDays, format, isSameWeek, isToday } from 'date-fns';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { RefreshCw, Terminal, MessageSquareText, PlusCircle, Edit, Trash2, Download } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useToast } from '@/hooks/use-toast';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { ShiftFormDialog } from './shift-form-dialog';


const getStatusBadge = (shift: Shift) => {
    const baseProps = { className: "capitalize" };
    switch (shift.status) {
        case 'pending-confirmation':
            return <Badge variant="secondary" {...baseProps}>Pending</Badge>;
        case 'confirmed':
            return <Badge {...baseProps}>Confirmed</Badge>;
        case 'completed':
            return <Badge {...baseProps} className="bg-green-600 hover:bg-green-700 text-white">Completed</Badge>;
        case 'incomplete':
             return (
                <div className="flex items-center gap-1 justify-end">
                    <Badge variant="destructive" {...baseProps} className="bg-amber-600 hover:bg-amber-700 text-white border-amber-600">Incomplete</Badge>
                    {shift.notes && (
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7">
                                    <MessageSquareText className="h-4 w-4 text-muted-foreground" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-64 sm:w-80">
                                <div className="space-y-2">
                                    <h4 className="font-medium leading-none">Notes</h4>
                                    <p className="text-sm text-muted-foreground">{shift.notes}</p>
                                </div>
                            </PopoverContent>
                        </Popover>
                    )}
                </div>
            );
        default:
            return <Badge variant="outline" {...baseProps}>Unknown</Badge>;
    }
}

interface ShiftScheduleOverviewProps {
  userProfile: UserProfile;
}

export function ShiftScheduleOverview({ userProfile }: ShiftScheduleOverviewProps) {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedShift, setSelectedShift] = useState<Shift | null>(null);
  const [shiftToDelete, setShiftToDelete] = useState<Shift | null>(null);
  const { toast } = useToast();
  
  const isOwner = userProfile.role === 'owner';

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
  }, [refreshKey]);

  const getCorrectedLocalDate = (date: { toDate: () => Date }) => {
    const d = date.toDate();
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  };

  const { todayShifts, thisWeekShifts, nextWeekShifts } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayShifts = shifts.filter(s => isToday(getCorrectedLocalDate(s.date)));
    
    const thisWeekShifts = shifts.filter(s => 
        isSameWeek(getCorrectedLocalDate(s.date), today, { weekStartsOn: 1 })
    );

    const nextWeekShifts = shifts.filter(s => {
        const shiftDate = getCorrectedLocalDate(s.date);
        const startOfThisWeek = addDays(today, - (today.getDay() === 0 ? 6 : today.getDay() - 1));
        const startOfNextWeek = addDays(startOfThisWeek, 7);
        return isSameWeek(shiftDate, startOfNextWeek, { weekStartsOn: 1 });
    });

    return { todayShifts, thisWeekShifts, nextWeekShifts };
  }, [shifts]);

  const handleAddShift = () => {
    setSelectedShift(null);
    setIsFormOpen(true);
  };
  
  const handleEditShift = (shift: Shift) => {
    setSelectedShift(shift);
    setIsFormOpen(true);
  };
  
  const handleDeleteShift = async () => {
    if (!shiftToDelete || !db) return;
    try {
        await deleteDoc(doc(db, 'shifts', shiftToDelete.id));
        toast({ title: 'Success', description: 'Shift has been deleted.' });
    } catch (error) {
        console.error("Error deleting shift:", error);
        toast({ variant: 'destructive', title: 'Error', description: 'Could not delete the shift.' });
    } finally {
        setShiftToDelete(null);
    }
  };

  const handleDownloadPdf = async () => {
    const { default: jsPDF } = await import('jspdf');
    const { default: autoTable } = await import('jspdf-autotable');

    const doc = new jsPDF();
    const generationDate = new Date();

    doc.setFontSize(18);
    doc.text(`Team Shift Schedule`, 14, 22);
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(`Generated on: ${format(generationDate, 'PPP p')}`, 14, 28);

    let finalY = 35;

    const generateTablesForPeriod = (title: string, shiftsForPeriod: Shift[]) => {
      if (shiftsForPeriod.length === 0) return;

      doc.setFontSize(16);
      doc.text(title, 14, finalY);
      finalY += 10;

      const shiftsByUser = new Map<string, Shift[]>();
      shiftsForPeriod.forEach(shift => {
        if (!shiftsByUser.has(shift.userId)) {
          shiftsByUser.set(shift.userId, []);
        }
        shiftsByUser.get(shift.userId)!.push(shift);
      });

      const sortedUsers = [...users].sort((a, b) => a.name.localeCompare(b.name)).filter(u => shiftsByUser.has(u.uid));

      for (const user of sortedUsers) {
        const userShifts = shiftsByUser.get(user.uid) || [];
        if (userShifts.length === 0) continue;

        userShifts.sort((a, b) => getCorrectedLocalDate(a.date).getTime() - getCorrectedLocalDate(b.date).getTime());

        doc.setFontSize(12);
        doc.text(user.name, 14, finalY);
        finalY += 7;

        const head = [['Date', 'Type', 'Task', 'Address', 'Status']];
        const body = userShifts.map(shift => {
          const shiftDate = getCorrectedLocalDate(shift.date);
          return [
            format(shiftDate, 'EEE, dd MMM'),
            shift.type === 'all-day' ? 'All Day' : shift.type.toUpperCase(),
            shift.task,
            shift.address,
            shift.status.replace('-confirmation', ''),
          ];
        });

        autoTable(doc, {
          head,
          body,
          startY: finalY,
          headStyles: { fillColor: [41, 128, 185], textColor: 255 },
          margin: { top: 10 },
          didDrawPage: (data) => {
            finalY = data.cursor?.y ?? finalY;
          },
        });
        finalY = (doc as any).lastAutoTable.finalY + 10;
      }
      finalY += 5; // Extra space between periods
    };

    generateTablesForPeriod("Today's Shifts", todayShifts);
    generateTablesForPeriod("This Week's Shifts", thisWeekShifts);
    generateTablesForPeriod("Next Week's Shifts", nextWeekShifts);

    if (todayShifts.length === 0 && thisWeekShifts.length === 0 && nextWeekShifts.length === 0) {
      doc.text("No shifts scheduled for these periods.", 14, finalY);
    }

    doc.save(`team_schedule_${format(generationDate, 'yyyy-MM-dd')}.pdf`);
  };


  const renderWeekSchedule = (weekShifts: Shift[], usersForView: UserProfile[]) => {
    if (loading) {
      return (
        <div className="space-y-8 mt-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i}>
              <Skeleton className="h-7 w-48 mb-4" />
              <div className="border rounded-lg overflow-hidden">
                <Skeleton className="h-48 w-full" />
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
          No shifts scheduled for this period.
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
        const typeOrder = { 'am': 1, 'pm': 2, 'all-day': 3 };
        userShifts.sort((a, b) => {
            const dateA = getCorrectedLocalDate(a.date).getTime();
            const dateB = getCorrectedLocalDate(b.date).getTime();
            if (dateA !== dateB) {
                return dateA - dateB;
            }
            return typeOrder[a.type] - typeOrder[b.type];
        });
    });

    return (
      <div className="space-y-8 mt-4">
        {activeUsers.map(user => {
            const userShifts = shiftsByUser.get(user.uid) || [];
            if (userShifts.length === 0) return null;

            return (
                <div key={user.uid}>
                    <h3 className="text-lg md:text-xl font-semibold mb-3">{user.name}</h3>

                    {/* Desktop Table View */}
                    <Card className="hidden md:block">
                        <CardContent className="p-0">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-[180px]">Date</TableHead>
                                        <TableHead>Task</TableHead>
                                        <TableHead>Address</TableHead>
                                        <TableHead className="text-right w-[110px]">Type</TableHead>
                                        <TableHead className="text-right w-[160px]">Status</TableHead>
                                        {isOwner && <TableHead className="text-right w-[140px]">Actions</TableHead>}
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
                                            <TableCell className="text-right">
                                                {getStatusBadge(shift)}
                                            </TableCell>
                                            {isOwner && (
                                                <TableCell className="text-right">
                                                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEditShift(shift)}>
                                                        <Edit className="h-4 w-4" />
                                                    </Button>
                                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive/70 hover:text-destructive hover:bg-destructive/10" onClick={() => setShiftToDelete(shift)}>
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </TableCell>
                                            )}
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>

                    {/* Mobile Card View */}
                    <div className="space-y-4 md:hidden">
                        {userShifts.map(shift => (
                           <Card key={shift.id}>
                                <CardHeader>
                                    <div className="flex justify-between items-start gap-2">
                                        <div>
                                            <CardTitle className="text-base">{shift.task}</CardTitle>
                                            <CardDescription>{shift.address}</CardDescription>
                                        </div>
                                        <Badge variant={shift.type === 'am' ? 'default' : shift.type === 'pm' ? 'secondary' : 'outline'} className="capitalize text-xs whitespace-nowrap">
                                            {shift.type === 'all-day' ? 'All Day' : shift.type.toUpperCase()}
                                        </Badge>
                                    </div>
                                </CardHeader>
                                <CardContent className="text-sm text-muted-foreground">
                                    {format(getCorrectedLocalDate(shift.date), 'eeee, MMM d')}
                                </CardContent>
                                <CardFooter className="p-2 bg-muted/30 flex justify-between items-center">
                                    {getStatusBadge(shift)}
                                    {isOwner && (
                                        <div className="flex items-center">
                                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEditShift(shift)}>
                                                <Edit className="h-4 w-4" />
                                            </Button>
                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive/70 hover:text-destructive hover:bg-destructive/10" onClick={() => setShiftToDelete(shift)}>
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    )}
                                </CardFooter>
                           </Card>
                        ))}
                    </div>
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
    <>
        <Card>
        <CardHeader>
            <div className="flex items-center justify-between gap-4">
                <div>
                    <CardTitle>Team Schedule Overview</CardTitle>
                    <CardDescription>A list of all upcoming shifts for the team, grouped by operative. The schedule updates in real-time.</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                    {isOwner && (
                        <Button onClick={handleAddShift}>
                            <PlusCircle className="mr-2 h-4 w-4" />
                            Add Shift
                        </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={handleDownloadPdf} disabled={loading}>
                        <Download className="mr-2 h-4 w-4" />
                        Download PDF
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setRefreshKey(prev => prev + 1)}>
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Refresh
                    </Button>
                </div>
            </div>
        </CardHeader>
        <CardContent>
            <Tabs defaultValue="today">
            <TabsList>
                <TabsTrigger value="today">Today</TabsTrigger>
                <TabsTrigger value="this-week">This Week</TabsTrigger>
                <TabsTrigger value="next-week">Next Week</TabsTrigger>
            </TabsList>
            <TabsContent value="today" className="mt-0">
                {renderWeekSchedule(todayShifts, users)}
            </TabsContent>
            <TabsContent value="this-week" className="mt-0">
                {renderWeekSchedule(thisWeekShifts, users)}
            </TabsContent>
            <TabsContent value="next-week" className="mt-0">
                {renderWeekSchedule(nextWeekShifts, users)}
            </TabsContent>
            </Tabs>
        </CardContent>
        </Card>
        
        {isOwner && (
            <ShiftFormDialog 
                open={isFormOpen} 
                onOpenChange={setIsFormOpen} 
                users={users} 
                shift={selectedShift} 
            />
        )}
        
        <AlertDialog open={!!shiftToDelete} onOpenChange={() => setShiftToDelete(null)}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                    <AlertDialogDescription>
                        This action cannot be undone. This will permanently delete the shift for 
                        <span className="font-semibold"> {shiftToDelete?.task}</span> at 
                        <span className="font-semibold"> {shiftToDelete?.address}</span>.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDeleteShift} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                        Delete
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    </>
  );
}
