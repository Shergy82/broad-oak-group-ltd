'use client';

import { useEffect, useState, useMemo } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useUserProfile } from '@/hooks/use-user-profile';
import { ShiftCard } from '@/components/dashboard/shift-card';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  isToday,
  isSameWeek,
  addDays,
  format,
  subDays,
  startOfWeek,
} from 'date-fns';
import type { Shift, ShiftStatus } from '@/types';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { getCorrectedLocalDate } from '@/lib/utils';
import { Badge } from '../ui/badge';
import {
  Download,
  History,
  Clock,
  Sunrise,
  Sunset,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export default function Dashboard({
  userShifts,
  loading,
}: {
  userShifts: Shift[];
  loading: boolean;
}) {
  const { user } = useAuth();
  const { userProfile } = useUserProfile();
  const { toast } = useToast();
  const [dismissedShiftIds, setDismissedShiftIds] = useState<string[]>([]);

  useEffect(() => {
    if (user) {
      const storedDismissedIds = localStorage.getItem(
        `dismissedShifts_${user.uid}`
      );
      if (storedDismissedIds) {
        setDismissedShiftIds(JSON.parse(storedDismissedIds));
      }
    }
  }, [user]);

  const handleDismissShift = (shiftId: string) => {
    if (!user) return;
    const newDismissedIds = [...dismissedShiftIds, shiftId];
    setDismissedShiftIds(newDismissedIds);
    localStorage.setItem(
      `dismissedShifts_${user.uid}`,
      JSON.stringify(newDismissedIds)
    );
    toast({
      title: 'Shift Hidden',
      description: 'The shift has been dismissed from your view.',
    });
  };
  
  const handleDownloadSchedule = async () => {
    if (!userProfile) {
      toast({ title: 'Could not generate PDF', description: 'User profile not loaded.' });
      return;
    }
    
    const today = new Date();
    const thisWeekShifts = userShifts.filter(s => isSameWeek(getCorrectedLocalDate(s.date), today, { weekStartsOn: 1 }));
    const nextWeekShifts = userShifts.filter(s => isSameWeek(getCorrectedLocalDate(s.date), addDays(today, 7), { weekStartsOn: 1 }));

    if (thisWeekShifts.length === 0 && nextWeekShifts.length === 0) {
      toast({ title: 'No shifts to download for this or next week.' });
      return;
    }

    const { default: jsPDF } = await import('jspdf');
    const { default: autoTable } = await import('jspdf-autotable');

    const doc = new jsPDF();
    const generationDate = new Date();
    
    doc.setFontSize(18);
    doc.text(`Your Shift Schedule - ${userProfile.name}`, 14, 22);
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(`Generated on: ${format(generationDate, 'PPP p')}`, 14, 28);

    let finalY = 35;

    const generateTable = (title: string, shiftsForPeriod: Shift[]) => {
      if (shiftsForPeriod.length === 0) return;

      const sortedShifts = shiftsForPeriod.sort((a,b) => getCorrectedLocalDate(a.date).getTime() - getCorrectedLocalDate(b.date).getTime());

      if (finalY > 40) finalY += 8;
      doc.setFontSize(16);
      doc.text(title, 14, finalY);
      finalY += 10;
      
      const head = [['Date', 'Type', 'Task & Address', 'Status']];
      const body = sortedShifts.map(shift => {
        const shiftDate = getCorrectedLocalDate(shift.date);
        return [
          format(shiftDate, 'EEE, dd MMM'),
          shift.type === 'all-day' ? 'All Day' : shift.type.toUpperCase(),
          `${shift.task}\n${shift.address}`,
          shift.status.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
        ];
      });

      autoTable(doc, {
        head,
        body,
        startY: finalY,
        headStyles: { fillColor: [6, 95, 212] },
        didDrawPage: (data: any) => {
            finalY = data.cursor?.y || 0;
        },
      });
      finalY = (doc as any).lastAutoTable.finalY;
    };
    
    generateTable("This Week's Shifts", thisWeekShifts);
    generateTable("Next Week's Shifts", nextWeekShifts);
    
    doc.save(`my_schedule_${format(generationDate, 'yyyy-MM-dd')}.pdf`);
  };

  const {
    todayAmShifts,
    todayPmShifts,
    todayAllDayShifts,
    thisWeekShifts,
    lastWeekShifts,
    nextWeekShifts,
    week3Shifts,
    week4Shifts,
    historicalShifts,
  } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const fourWeeksAgo = subDays(today, 28);

    const visibleShifts = userShifts.filter(
      (s) => !dismissedShiftIds.includes(s.id)
    );

    const activeStatuses: ShiftStatus[] = [
      'pending-confirmation',
      'confirmed',
      'on-site',
      'rejected',
    ];

    const activeShifts = visibleShifts.filter((s) =>
      activeStatuses.includes(s.status)
    );

    const historical = visibleShifts
      .filter((s) => {
        const isHistorical =
          s.status === 'completed' || s.status === 'incomplete';
        if (!isHistorical) return false;
        const shiftDate = getCorrectedLocalDate(s.date);
        return shiftDate >= fourWeeksAgo;
      })
      .sort(
        (a, b) =>
          getCorrectedLocalDate(b.date).getTime() -
          getCorrectedLocalDate(a.date).getTime()
      );

    const groupByDay = (weekShifts: Shift[]) => {
      const grouped: { [key: string]: Shift[] } = {};
      weekShifts.forEach((shift) => {
        const dayName = format(
          getCorrectedLocalDate(shift.date),
          'eeee'
        );
        if (!grouped[dayName]) grouped[dayName] = [];
        grouped[dayName].push(shift);
      });
      return grouped;
    };

    const activeToday = activeShifts.filter((s) =>
      isToday(getCorrectedLocalDate(s.date))
    );

    const todayAm = activeToday.filter((s) => s.type === 'am');
    const todayPm = activeToday.filter((s) => s.type === 'pm');
    const todayAll = activeToday.filter((s) => s.type === 'all-day');

    const activeThisWeek = activeShifts.filter((s) =>
      isSameWeek(getCorrectedLocalDate(s.date), today, {
        weekStartsOn: 1,
      })
    );

    const startOfLastWeek = startOfWeek(subDays(today, 7), {
      weekStartsOn: 1,
    });

    const activeLastWeek = activeShifts.filter((s) =>
      isSameWeek(
        getCorrectedLocalDate(s.date),
        startOfLastWeek,
        { weekStartsOn: 1 }
      )
    );

    const activeNextWeek = activeShifts.filter((s) =>
      isSameWeek(
        getCorrectedLocalDate(s.date),
        addDays(today, 7),
        { weekStartsOn: 1 }
      )
    );

    const activeWeek3 = activeShifts.filter((s) =>
      isSameWeek(
        getCorrectedLocalDate(s.date),
        addDays(today, 14),
        { weekStartsOn: 1 }
      )
    );

    const activeWeek4 = activeShifts.filter((s) =>
      isSameWeek(
        getCorrectedLocalDate(s.date),
        addDays(today, 21),
        { weekStartsOn: 1 }
      )
    );

    return {
      todayAmShifts: todayAm,
      todayPmShifts: todayPm,
      todayAllDayShifts: todayAll,
      thisWeekShifts: groupByDay(activeThisWeek),
      lastWeekShifts: groupByDay(activeLastWeek),
      nextWeekShifts: groupByDay(activeNextWeek),
      week3Shifts: groupByDay(activeWeek3),
      week4Shifts: groupByDay(activeWeek4),
      historicalShifts: historical,
    };
  }, [userShifts, dismissedShiftIds]);

  return (
    <div className="w-full space-y-8">

      {/* Greeting */}
      {user?.displayName && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h2 className="text-xl sm:text-2xl font-semibold">
              Hi, {user.displayName.split(' ')[0]}
            </h2>
            {userProfile?.operativeId && (
              <Badge variant="secondary">
                ID: {userProfile.operativeId}
              </Badge>
            )}
          </div>

          <Button
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={handleDownloadSchedule}
          >
            <Download className="mr-2 h-4 w-4" />
            Download Schedule
          </Button>
        </div>
      )}

      {/* Responsive Scroll Tabs */}
      <Tabs defaultValue="today" className="w-full">
        <div className="overflow-x-auto pb-2">
          <TabsList className="flex w-max min-w-full gap-2">
            <TabsTrigger value="last-week">Last Week</TabsTrigger>
            <TabsTrigger value="today">Today</TabsTrigger>
            <TabsTrigger value="this-week">This Week</TabsTrigger>
            <TabsTrigger value="next-week">Next Week</TabsTrigger>
            <TabsTrigger value="week-3">Week 3</TabsTrigger>
            <TabsTrigger value="week-4">Week 4</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="today">
          <div className="space-y-6 mt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <h3 className="flex items-center text-lg font-semibold text-sky-600">
                  <Sunrise className="mr-2 h-5 w-5" />
                  AM Shifts
                </h3>
                {todayAmShifts.map((shift) => (
                  <ShiftCard
                    key={shift.id}
                    shift={shift}
                    userProfile={userProfile}
                  />
                ))}
              </div>

              <div className="space-y-4">
                <h3 className="flex items-center text-lg font-semibold text-orange-600">
                  <Sunset className="mr-2 h-5 w-5" />
                  PM Shifts
                </h3>
                {todayPmShifts.map((shift) => (
                  <ShiftCard
                    key={shift.id}
                    shift={shift}
                    userProfile={userProfile}
                  />
                ))}
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Recently Completed */}
      {historicalShifts.length > 0 && (
        <div className="mt-8">
          <h3 className="text-xl font-semibold mb-4 flex items-center">
            <History className="mr-3 h-6 w-6 text-muted-foreground" />
            Recently Completed
          </h3>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {historicalShifts.map((shift) => (
              <ShiftCard
                key={shift.id}
                shift={shift}
                userProfile={userProfile}
                onDismiss={handleDismissShift}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
