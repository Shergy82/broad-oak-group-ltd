
'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, doc, deleteDoc } from 'firebase/firestore';
import { db, functions, httpsCallable } from '@/lib/firebase';
import type { Shift, UserProfile } from '@/types';
import { addDays, format, isSameWeek, isToday } from 'date-fns';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { RefreshCw, Terminal, MessageSquareText, PlusCircle, Edit, Trash2, Download, History, Trash } from 'lucide-react';
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
    AlertDialogTrigger
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
  const [isDeletingAll, setIsDeletingAll] = useState(false);
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

  const userNameMap = useMemo(() => {
    const map = new Map<string, string>();
    users.forEach(user => map.set(user.uid, user.name));
    return map;
  }, [users]);

  const handleAddShift = () => {
    setSelectedShift(null);
    setIsFormOpen(true);
  };
  
  const handleEditShift = (shift: Shift) => {
    setSelectedShift(shift);
    setIsFormOpen(true);
  };
  
  const handleDeleteShift = async (shift: Shift) => {
    if (!db) return;
    if (!shift) {
        setShiftToDelete(null);
        return;
    };
    try {
        await deleteDoc(doc(db, 'shifts', shift.id));
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
    const pageContentMargin = 14;
    const pageHeight = doc.internal.pageSize.height;

    const addPageNumbers = () => {
        const pageCount = doc.internal.pages.length - 1;
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setFontSize(10);
            doc.setTextColor(150);
            doc.text(`Page ${i} of ${pageCount}`, doc.internal.pageSize.width - pageContentMargin, pageHeight - 10, { align: 'right' });
        }
    };

    doc.setFontSize(18);
    doc.text(`Team Shift Schedule`, pageContentMargin, 22);
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(`Generated on: ${format(generationDate, 'PPP p')}`, pageContentMargin, 28);

    let finalY = 35;

    const generateTablesForPeriod = (title: string, shiftsForPeriod: Shift[]) => {
      if (shiftsForPeriod.length === 0) return;

      if (finalY > 40) { // Add space if it's not the first section
        finalY += 5;
      }
      doc.setFontSize(16);
      doc.text(title, pageContentMargin, finalY);
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
        
        const head = [['Date', 'Type', 'Task & Address', 'Status']];
        const body = userShifts.map(shift => {
          const shiftDate = getCorrectedLocalDate(shift.date);
          const statusText = shift.status.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
          let taskAndAddress = `${shift.task}\n${shift.address}`;

          return {
            date: format(shiftDate, 'EEE, dd MMM'),
            type: shift.type === 'all-day' ? 'All Day' : shift.type.toUpperCase(),
            task: taskAndAddress,
            status: statusText,
            notes: (shift.status === 'incomplete' && shift.notes) ? `Note: ${shift.notes}` : null,
          };
        });
        
        const tableStartY = (doc as any).lastAutoTable ? (doc as any).lastAutoTable.finalY + 10 : finalY;
        
        autoTable(doc, {
          head,
          body: body.map(row => [row.date, row.type, row.task, row.status]),
          startY: tableStartY,
          headStyles: { fillColor: [6, 95, 212] },
          didDrawPage: (data) => {
            finalY = data.cursor?.y || 0;
          },
          didParseCell: (data) => {
            if (data.section === 'body' && data.column.dataKey === 2) { // Task & Address column
              const rowData = body[data.row.index];
              if (rowData.notes) {
                // Combine task/address and the note into a multi-line cell
                data.cell.text = [rowData.task, '', rowData.notes];
              }
            }
          },
          willDrawCell: (data) => {
             if (data.section === 'body' && data.column.dataKey === 2) { // Task & Address column
                const rowData = body[data.row.index];
                if (rowData.notes) {
                    const textLines = doc.splitTextToSize(rowData.task, data.cell.contentWidth);
                    const textHeight = textLines.length * doc.getLineHeight();
                    const noteY = data.cell.y + (textHeight / doc.internal.scaleFactor) - (doc.getFontSize() / doc.internal.scaleFactor) + 2.5;

                    doc.setFillColor(255, 252, 204); // Light yellow
                    
                    doc.rect(
                        data.cell.x,
                        noteY,
                        data.cell.width,
                        (data.cell.height - (textHeight / doc.internal.scaleFactor)),
                        'F'
                    );
                }
             }
          },
          didDrawCell: (data) => {
            if (data.section === 'head' && data.row.index === 0) {
              doc.setFontSize(12);
              doc.setFont(doc.getFont().fontName, 'bold');
              doc.text(user.name, pageContentMargin, data.cell.y - 10);
            }
          }
        });
        finalY = (doc as any).lastAutoTable.finalY;
      }
    };

    generateTablesForPeriod("This Week's Shifts", thisWeekShifts);
    generateTablesForPeriod("Next Week's Shifts", nextWeekShifts);

    if (thisWeekShifts.length === 0 && nextWeekShifts.length === 0) {
      doc.text("No shifts scheduled for these periods.", pageContentMargin, finalY);
    }
    
    addPageNumbers();
    doc.save(`team_schedule_${format(generationDate, 'yyyy-MM-dd')}.pdf`);
  };

  const handleDeleteAllShifts = async () => {
    if (!functions) {
        toast({ variant: 'destructive', title: 'Error', description: 'Firebase Functions service not available.' });
        return;
    }
    setIsDeletingAll(true);
    toast({ title: 'Deleting All Shifts...', description: 'This may take a moment.' });
    
    try {
        const deleteAllShiftsFn = httpsCallable(functions, 'deleteAllShifts');
        const result = await deleteAllShiftsFn();
        toast({ title: 'Success', description: (result.data as any).message });
    } catch (error: any) {
        console.error("Error deleting all shifts:", error);
        toast({
            variant: 'destructive',
            title: 'Deletion Failed',
            description: error.message || 'An unknown error occurred.',
        });
    } finally {
        setIsDeletingAll(false);
    }
  };

  const renderShiftList = (shiftsToRender: Shift[]) => {
    if (shiftsToRender.length === 0) {
        return null;
    }
    
    return (
        <>
            {/* Desktop Table View */}
            <Card className="hidden md:block mt-4">
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[180px]">Date</TableHead>
                                <TableHead className="w-[180px]">Operative</TableHead>
                                <TableHead>Task &amp; Address</TableHead>
                                <TableHead className="text-right w-[110px]">Type</TableHead>
                                <TableHead className="text-right w-[160px]">Status</TableHead>
                                {isOwner && <TableHead className="text-right w-[140px]">Actions</TableHead>}
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {shiftsToRender.map(shift => (
                                <TableRow key={shift.id}>
                                    <TableCell className="font-medium">{format(getCorrectedLocalDate(shift.date), 'eeee, MMM d')}</TableCell>
                                    <TableCell>{userNameMap.get(shift.userId) || 'Unknown'}</TableCell>
                                    <TableCell>
                                        <div>{shift.task}</div>
                                        <div className="text-xs text-muted-foreground">{shift.address}</div>
                                    </TableCell>
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
                                            <AlertDialog>
                                                <AlertDialogTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive/70 hover:text-destructive hover:bg-destructive/10">
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </AlertDialogTrigger>
                                                <AlertDialogContent>
                                                    <AlertDialogHeader>
                                                        <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                                                        <AlertDialogDescription>
                                                            This action cannot be undone. This will permanently delete the shift for 
                                                            <span className="font-semibold"> {shift.task}</span> at 
                                                            <span className="font-semibold"> {shift.address}</span>.
                                                        </AlertDialogDescription>
                                                    </AlertDialogHeader>
                                                    <AlertDialogFooter>
                                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                        <AlertDialogAction onClick={() => handleDeleteShift(shift)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                                            Delete
                                                        </AlertDialogAction>
                                                    </AlertDialogFooter>
                                                </AlertDialogContent>
                                            </AlertDialog>
                                        </TableCell>
                                    )}
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            {/* Mobile Card View */}
            <div className="space-y-4 md:hidden mt-4">
                {shiftsToRender.map(shift => (
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
                        <CardContent className="text-sm text-muted-foreground space-y-1">
                            <div><strong>Operative:</strong> {userNameMap.get(shift.userId) || 'Unknown'}</div>
                            <div><strong>Date:</strong> {format(getCorrectedLocalDate(shift.date), 'eeee, MMM d')}</div>
                        </CardContent>
                        <CardFooter className="p-2 bg-muted/30 flex justify-between items-center">
                            {getStatusBadge(shift)}
                            {isOwner && (
                                <div className="flex items-center">
                                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEditShift(shift)}>
                                        <Edit className="h-4 w-4" />
                                    </Button>
                                    <AlertDialog>
                                        <AlertDialogTrigger asChild>
                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive/70 hover:text-destructive hover:bg-destructive/10">
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent>
                                            <AlertDialogHeader>
                                                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                                                <AlertDialogDescription>
                                                    This action cannot be undone. This will permanently delete the shift for 
                                                    <span className="font-semibold"> {shift.task}</span> at 
                                                    <span className="font-semibold"> {shift.address}</span>.
                                                </AlertDialogDescription>
                                            </AlertDialogHeader>
                                            <AlertDialogFooter>
                                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                <AlertDialogAction onClick={() => handleDeleteShift(shift)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                                    Delete
                                                </AlertDialogAction>
                                            </AlertDialogFooter>
                                        </AlertDialogContent>
                                    </AlertDialog>
                                </div>
                            )}
                        </CardFooter>
                   </Card>
                ))}
            </div>
        </>
    );
  }

  const renderWeekSchedule = (weekShifts: Shift[]) => {
    if (loading) {
      return (
        <div className="border rounded-lg overflow-hidden mt-4">
            <Skeleton className="h-48 w-full" />
        </div>
      );
    }
    
    const sortShifts = (shiftsToSort: Shift[]) => {
        return [...shiftsToSort].sort((a, b) => {
            const dateA = getCorrectedLocalDate(a.date).getTime();
            const dateB = getCorrectedLocalDate(b.date).getTime();
            if (dateA !== dateB) return dateA - dateB;
            
            const nameA = userNameMap.get(a.userId) || '';
            const nameB = userNameMap.get(b.userId) || '';
            if (nameA !== nameB) return nameA.localeCompare(nameB);
    
            const typeOrder = { 'am': 1, 'pm': 2, 'all-day': 3 };
            return typeOrder[a.type] - typeOrder[b.type];
        });
    }

    const activeShifts = sortShifts(weekShifts.filter(s => s.status === 'pending-confirmation' || s.status === 'confirmed'));
    const historicalShifts = sortShifts(weekShifts.filter(s => s.status === 'completed' || s.status === 'incomplete'))
      .sort((a,b) => getCorrectedLocalDate(b.date).getTime() - getCorrectedLocalDate(a.date).getTime());

    if (activeShifts.length === 0 && historicalShifts.length === 0) {
      return (
        <div className="h-24 text-center flex items-center justify-center text-muted-foreground mt-4 border border-dashed rounded-lg">
          No shifts scheduled for this period.
        </div>
      );
    }

    return (
        <>
            {activeShifts.length > 0 ? renderShiftList(activeShifts) : (
                <div className="h-24 text-center flex items-center justify-center text-muted-foreground mt-4 border border-dashed rounded-lg">
                    No active shifts scheduled for this period.
                </div>
            )}
            
            {historicalShifts.length > 0 && (
                <div className="mt-8">
                    <h3 className="text-xl md:text-2xl font-semibold tracking-tight mb-2 flex items-center">
                        <History className="mr-3 h-6 w-6 text-muted-foreground" />
                        Completed &amp; Incomplete
                    </h3>
                    {renderShiftList(historicalShifts)}
                </div>
            )}
        </>
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
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                    <CardTitle>Team Schedule Overview</CardTitle>
                    <CardDescription>A list of all upcoming shifts for the team, grouped by operative. The schedule updates in real-time.</CardDescription>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    {isOwner && (
                        <Button onClick={handleAddShift}>
                            <PlusCircle className="mr-2 h-4 w-4" />
                            Add Shift
                        </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={handleDownloadPdf} disabled={loading}>
                        <Download className="mr-2 h-4 w-4" />
                        PDF
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setRefreshKey(prev => prev + 1)}>
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Refresh
                    </Button>
                    {isOwner && (
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button variant="destructive" size="sm" disabled={isDeletingAll || shifts.length === 0}>
                                    <Trash className="mr-2 h-4 w-4" />
                                    {isDeletingAll ? 'Deleting...' : 'Delete All'}
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        This action cannot be undone. This will permanently delete ALL shifts for EVERY user from the database.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={handleDeleteAllShifts} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                        Yes, Delete Everything
                                    </AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    )}
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
                {renderWeekSchedule(todayShifts)}
            </TabsContent>
            <TabsContent value="this-week" className="mt-0">
                {renderWeekSchedule(thisWeekShifts)}
            </TabsContent>
            <TabsContent value="next-week" className="mt-0">
                {renderWeekSchedule(nextWeekShifts)}
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
                    <AlertDialogAction onClick={() => handleDeleteShift(shiftToDelete!)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                        Delete
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    </>
  );
}
