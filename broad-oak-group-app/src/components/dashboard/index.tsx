
'use client';

import { useEffect, useState, useMemo } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useUserProfile } from '@/hooks/use-user-profile';
import { ShiftCard } from '@/components/dashboard/shift-card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { isToday, isSameWeek, addDays, format, subDays, startOfWeek } from 'date-fns';
import type { Shift, ShiftStatus } from '@/types';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { getCorrectedLocalDate } from '@/lib/utils';
import { Badge } from '../ui/badge';
import { Download, History, Clock, Sunrise, Sunset } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function Dashboard({ userShifts, loading }: { userShifts: Shift[], loading: boolean }) {
  const { user } = useAuth();
  const { userProfile } = useUserProfile();
  const { toast } = useToast();
  const [dismissedShiftIds, setDismissedShiftIds] = useState<string[]>([]);
  
  useEffect(() => {
    if (user) {
        const storedDismissedIds = localStorage.getItem(`dismissedShifts_${user.uid}`);
        if (storedDismissedIds) {
            setDismissedShiftIds(JSON.parse(storedDismissedIds));
        }
    }
  }, [user]);

  const handleDismissShift = (shiftId: string) => {
      if (!user) return;
      const newDismissedIds = [...dismissedShiftIds, shiftId];
      setDismissedShiftIds(newDismissedIds);
      localStorage.setItem(`dismissedShifts_${user.uid}`, JSON.stringify(newDismissedIds));
      toast({
        title: 'Shift Hidden',
        description: 'The shift has been dismissed from your view.',
      });
  };

  const { 
    todayAmShifts,
    todayPmShifts,
    todayAllDayShifts,
    thisWeekShifts, 
    lastWeekShifts,
    nextWeekShifts,
    historicalShifts,
  } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const fourWeeksAgo = subDays(today, 28);

    const visibleShifts = userShifts.filter(s => !dismissedShiftIds.includes(s.id));

    const activeStatuses: ShiftStatus[] = ['pending-confirmation', 'confirmed', 'on-site', 'rejected'];
    const activeShifts = visibleShifts.filter(s => activeStatuses.includes(s.status));
    
    const historical = visibleShifts.filter(s => {
        const isHistorical = s.status === 'completed' || s.status === 'incomplete';
        if (!isHistorical) return false;
        const shiftDate = getCorrectedLocalDate(s.date);
        return shiftDate >= fourWeeksAgo;
    }).sort((a, b) => getCorrectedLocalDate(b.date).getTime() - getCorrectedLocalDate(a.date).getTime());

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
    
    const activeTodayShifts = activeShifts.filter(s => isToday(getCorrectedLocalDate(s.date)));
    const todayAm = activeTodayShifts.filter(s => s.type === 'am');
    const todayPm = activeTodayShifts.filter(s => s.type === 'pm');
    const todayAllDay = activeTodayShifts.filter(s => s.type === 'all-day');

    const activeThisWeekShifts = activeShifts.filter(s => isSameWeek(getCorrectedLocalDate(s.date), today, { weekStartsOn: 1 }));
    
    const startOfLastWeek = startOfWeek(subDays(today, 7), { weekStartsOn: 1 });
    const activeLastWeekShifts = activeShifts.filter(s => isSameWeek(getCorrectedLocalDate(s.date), startOfLastWeek, { weekStartsOn: 1 }));

    const activeNextWeekShifts = activeShifts.filter(s => {
        const shiftDate = getCorrectedLocalDate(s.date);
        const startOfNextWeek = addDays(today, 7);
        return isSameWeek(shiftDate, startOfNextWeek, { weekStartsOn: 1 });
    });

    return {
      todayAmShifts: todayAm,
      todayPmShifts: todayPm,
      todayAllDayShifts: todayAllDay,
      thisWeekShifts: groupShiftsByDay(activeThisWeekShifts),
      lastWeekShifts: groupShiftsByDay(activeLastWeekShifts),
      nextWeekShifts: groupShiftsByDay(activeNextWeekShifts),
      historicalShifts: historical,
    };
  }, [userShifts, dismissedShiftIds]);

  const handleDownloadPdf = async () => {
    const { default: jsPDF } = await import('jspdf');
    const { default: autoTable } = await import('jspdf-autotable');

    const doc = new jsPDF();
    const userName = user?.displayName || 'User';
    const generationDate = new Date();

    doc.setFontSize(18);
    doc.text(`Shift Schedule for ${userName}`, 14, 22);
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(`Generated on: ${format(generationDate, 'PPP p')}`, 14, 28);
    
    let finalY = 35;

    const generateTableForShifts = (title: string, shiftsForTable: Shift[]) => {
      if (shiftsForTable.length === 0) return;
      
      doc.setFontSize(16);
      doc.text(title, 14, finalY);
      finalY += 10;

      const head = [['Date', 'Type', 'Task', 'Address']];
      const body = shiftsForTable.map(shift => {
          const shiftDate = getCorrectedLocalDate(shift.date);
          return [
              format(shiftDate, 'EEE, dd MMM'),
              shift.type === 'all-day' ? 'All Day' : shift.type.toUpperCase(),
              shift.task,
              shift.address,
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
      
      finalY = (doc as any).lastAutoTable.finalY + 15;
    };
    
    const today = new Date();
    const thisWeek = userShifts.filter(s => isSameWeek(getCorrectedLocalDate(s.date), today, { weekStartsOn: 1 }));
    const nextWeek = userShifts.filter(s => {
        const shiftDate = getCorrectedLocalDate(s.date);
        const startOfNextWeek = addDays(today, 7);
        return isSameWeek(shiftDate, startOfNextWeek, { weekStartsOn: 1 });
    });

    generateTableForShifts("This Week's Shifts", thisWeek);
    generateTableForShifts("Next Week's Shifts", nextWeek);

    if (thisWeek.length === 0 && nextWeek.length === 0) {
      doc.text("No shifts scheduled for this week or next week.", 14, finalY);
    }
    
    doc.save(`shift_schedule_${userName.replace(/\s/g, '_')}.pdf`);
  };

  const renderWeekView = (groupedShifts: { [key: string]: Shift[] }, weekName: string, isHistorical: boolean = false) => {
    const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    const weekends = ['Saturday', 'Sunday'];
    const allDays = [...weekdays, ...weekends];
    
    const hasShiftsThisWeek = Object.keys(groupedShifts).length > 0 && Object.values(groupedShifts).some(s => s.length > 0);

    if (loading) {
        return (
            <div className="space-y-6">
                {weekdays.slice(0,3).map((day) => (
                    <Card key={day}>
                        <CardHeader><Skeleton className="h-6 w-32" /></CardHeader>
                        <CardContent><Skeleton className="h-24 w-full" /></CardContent>
                    </Card>
                ))}
            </div>
        )
    }

    if (!hasShiftsThisWeek) {
        return <p className="text-muted-foreground mt-4 text-center">No active shifts scheduled for {weekName}.</p>;
    }

    return (
        <div className="space-y-6">
            {allDays.map(day => {
                const shiftsForDay = groupedShifts[day];
                if (!shiftsForDay || shiftsForDay.length === 0) {
                    return null;
                }
                const typeOrder = { 'am': 1, 'pm': 2, 'all-day': 3 };
                shiftsForDay.sort((a,b) => typeOrder[a.type] - typeOrder[b.type]);


                const amShifts = shiftsForDay.filter(s => s.type === 'am');
                const pmShifts = shiftsForDay.filter(s => s.type === 'pm');
                const allDayShifts = shiftsForDay.filter(s => s.type === 'all-day');

                return (
                    <Card key={day} className={cn(isHistorical && "bg-muted/30 border-muted-foreground/20")}>
                        <CardHeader>
                            <CardTitle>{day}</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
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
                            {allDayShifts.length > 0 && (
                                <div>
                                    <h4 className="text-md font-semibold mb-3 flex items-center text-indigo-600 dark:text-indigo-400"><Clock className="mr-2 h-4 w-4" /> All Day</h4>
                                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                                        {allDayShifts.map(shift => <ShiftCard key={shift.id} shift={shift} />)}
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
  
  return (
    <div className="w-full space-y-8">
      {user?.displayName && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <h2 className="text-xl md:text-2xl font-semibold tracking-tight">
                Hi, {user.displayName.split(' ')[0]}
              </h2>
              {userProfile?.operativeId && <Badge variant="secondary">ID: {userProfile.operativeId}</Badge>}
            </div>
            <Button variant="outline" size="sm" onClick={handleDownloadPdf} disabled={loading}>
              <Download className="mr-2 h-4 w-4" />
              Download Schedule
            </Button>
        </div>
      )}
      
      <Tabs defaultValue="today" className="w-full">
        <TabsList>
          <TabsTrigger value="today">Today</TabsTrigger>
          <TabsTrigger value="this-week">This Week</TabsTrigger>
          <TabsTrigger value="next-week">Next Week</TabsTrigger>
          <TabsTrigger value="last-week" className="data-[state=active]:bg-amber-100 data-[state=active]:text-amber-800 dark:data-[state=active]:bg-amber-900/50 dark:data-[state=active]:text-amber-300">Last Week</TabsTrigger>
        </TabsList>
        <TabsContent value="today">
          {loading ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 mt-4">
              {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-40 w-full rounded-lg" />
              ))}
            </div>
          ) : todayAmShifts.length === 0 && todayPmShifts.length === 0 && todayAllDayShifts.length === 0 ? (
            <p className="col-span-full mt-4 text-center text-muted-foreground">No active shifts scheduled for today.</p>
          ) : (
            <div className="space-y-6 mt-4">
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                  <div className="space-y-4">
                      <h3 className="flex items-center text-lg md:text-xl font-semibold text-sky-600 dark:text-sky-400"><Sunrise className="mr-2 h-5 w-5" /> AM Shifts</h3>
                      {todayAmShifts.length > 0 
                          ? todayAmShifts.map(shift => <ShiftCard key={shift.id} shift={shift} />)
                          : <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">No AM shifts scheduled.</p>}
                  </div>
                  <div className="space-y-4">
                      <h3 className="flex items-center text-lg md:text-xl font-semibold text-orange-600 dark:text-orange-400"><Sunset className="mr-2 h-5 w-5" /> PM Shifts</h3>
                      {todayPmShifts.length > 0
                          ? todayPmShifts.map(shift => <ShiftCard key={shift.id} shift={shift} />)
                          : <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">No PM shifts scheduled.</p>}
                  </div>
              </div>
              {todayAllDayShifts.length > 0 && (
                  <Card>
                      <CardHeader><CardTitle className="flex items-center text-indigo-600 dark:text-indigo-400"><Clock className="mr-2 h-5 w-5" /> All Day</CardTitle></CardHeader>
                      <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                          {todayAllDayShifts.map(shift => <ShiftCard key={shift.id} shift={shift} />)}
                      </CardContent>
                  </Card>
              )}
            </div>
          )}
        </TabsContent>
        <TabsContent value="this-week">
          {renderWeekView(thisWeekShifts, "this week")}
        </TabsContent>
        <TabsContent value="next-week">
          {renderWeekView(nextWeekShifts, "next week")}
        </TabsContent>
        <TabsContent value="last-week">
          {renderWeekView(lastWeekShifts, "last week", true)}
        </TabsContent>
      </Tabs>
      
      {loading ? (
        <div className="mt-8">
            <Skeleton className="h-8 w-72 mb-4" />
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                <Skeleton className="h-32 w-full rounded-lg" />
                <Skeleton className="h-32 w-full rounded-lg" />
            </div>
        </div>
      ) : historicalShifts.length > 0 && (
        <div className="mt-8">
            <h3 className="text-xl md:text-2xl font-semibold tracking-tight mb-4 flex items-center">
                <History className="mr-3 h-6 w-6 text-muted-foreground" />
                Recently Completed & Incomplete
            </h3>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {historicalShifts.map(shift => (
                    <ShiftCard key={shift.id} shift={shift} onDismiss={handleDismissShift} />
                ))}
            </div>
        </div>
      )}
    </div>
  );
}

    
    