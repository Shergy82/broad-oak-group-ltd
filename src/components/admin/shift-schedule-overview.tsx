'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  collection,
  onSnapshot,
  query,
  doc,
  deleteDoc,
  where,
  getDocs,
} from 'firebase/firestore';
import { db, functions, httpsCallable } from '@/lib/firebase';
import type { Shift, UserProfile, Project } from '@/types';
import {
  addDays,
  format,
  isSameWeek,
  isToday,
  startOfWeek,
  endOfWeek,
  subWeeks,
} from 'date-fns';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Terminal,
  MessageSquareText,
  PlusCircle,
  Edit,
  Trash2,
  Download,
  History,
  Trash,
  Building,
  BarChart2,
  HardHat,
  ThumbsDown,
  CircleEllipsis,
  Calendar,
} from 'lucide-react';
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { ShiftFormDialog } from './shift-form-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useRouter } from 'next/navigation';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const getStatusBadge = (shift: Shift) => {
  const baseProps = { className: 'capitalize' };

  switch (shift.status) {
    case 'pending-confirmation':
      return (
        <Badge variant="secondary" {...baseProps}>
          Pending
        </Badge>
      );
    case 'confirmed':
      return <Badge {...baseProps}>Confirmed</Badge>;
    case 'on-site':
      return (
        <Badge {...baseProps} className="bg-teal-500 hover:bg-teal-600">
          <HardHat className="mr-1.5 h-3 w-3" />
          On Site
        </Badge>
      );
    case 'completed':
      return (
        <Badge {...baseProps} className="bg-green-600 hover:bg-green-700 text-white">
          Completed
        </Badge>
      );
    case 'rejected':
      return (
        <div className="flex items-center gap-1 justify-end">
          <Badge variant="destructive" {...baseProps}>
            <ThumbsDown className="mr-1.5 h-3 w-3" />
            Rejected
          </Badge>
          {shift.notes && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7">
                  <MessageSquareText className="h-4 w-4 text-muted-foreground" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 sm:w-80">
                <div className="space-y-2">
                  <h4 className="font-medium leading-none">Reason for Rejection</h4>
                  <p className="text-sm text-muted-foreground">{shift.notes}</p>
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
      );
    case 'incomplete':
      return (
        <div className="flex items-center gap-1 justify-end">
          <Badge
            variant="destructive"
            {...baseProps}
            className="bg-amber-600 hover:bg-amber-700 text-white border-amber-600"
          >
            Incomplete
          </Badge>
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
      return (
        <Badge variant="outline" {...baseProps}>
          Unknown
        </Badge>
      );
  }
};

interface ShiftScheduleOverviewProps {
  userProfile: UserProfile;
}

export function ShiftScheduleOverview({ userProfile }: ShiftScheduleOverviewProps) {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedShift, setSelectedShift] = useState<Shift | null>(null);

  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string>('all');
  const [selectedArchiveWeek, setSelectedArchiveWeek] = useState<string>('0');
  const [activeTab, setActiveTab] = useState('today');

  const { toast } = useToast();
  const router = useRouter();

  const isOwner = userProfile.role === 'owner';

  useEffect(() => {
    if (!db) {
      setLoading(false);
      setError('Firebase is not configured.');
      return;
    }

    // ✅ USERS (safe mapping + safe sort so one bad doc can't break everything)
    const usersQuery = query(collection(db, 'users'));
    const unsubscribeUsers = onSnapshot(
      usersQuery,
      (snapshot) => {
        const fetchedUsers = snapshot.docs.map((d) => {
          const data = d.data() as any;

          return {
            uid: d.id,
            ...data,
            name:
              typeof data?.name === 'string' && data.name.trim()
                ? data.name.trim()
                : typeof data?.email === 'string' && data.email.trim()
                  ? data.email.trim()
                  : '(No name)',
          } as UserProfile;
        });

        fetchedUsers.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        console.log('Users loaded:', fetchedUsers.length);
        setUsers(fetchedUsers);
      },
      (err) => {
        console.error('Error fetching users: ', err);
        setError('Could not fetch user data.');
        setLoading(false);
      }
    );

    const projectsQuery = query(collection(db, 'projects'));
    const unsubscribeProjects = onSnapshot(
      projectsQuery,
      (snapshot) => {
        setProjects(snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Project)));
      },
      (err) => {
        console.error('Error fetching projects: ', err);
        setError('Could not fetch project data.');
      }
    );

    const shiftsQuery = query(collection(db, 'shifts'));
    const unsubscribeShifts = onSnapshot(
      shiftsQuery,
      (snapshot) => {
        const fetchedShifts = snapshot.docs.map(
          (d) => ({ id: d.id, ...d.data() } as Shift)
        );
        setShifts(fetchedShifts);
        setLoading(false);
      },
      (err) => {
        console.error('Error fetching shifts: ', err);
        let errorMessage = 'Failed to fetch schedule. Please try again later.';
        if (err.code === 'permission-denied') {
          errorMessage =
            "You don't have permission to view the full schedule. This is because your project's Firestore security rules are too restrictive. Please open the `firestore.rules` file in your project, copy its contents, and paste them into the 'Rules' tab of your Cloud Firestore database in the Firebase Console.";
        } else if (err.code === 'failed-precondition') {
          errorMessage =
            'Could not fetch schedule. This is likely due to a missing database index. Please check the browser console for a link to create the required index in Firebase.';
        }
        setError(errorMessage);
        setLoading(false);
      }
    );

    return () => {
      unsubscribeUsers();
      unsubscribeShifts();
      unsubscribeProjects();
    };
  }, []);

  const getCorrectedLocalDate = (date: { toDate: () => Date }) => {
    const d = date.toDate();
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  };

  const filteredShifts = useMemo(() => {
    if (selectedUserId === 'all' || activeTab === 'archive') return shifts;
    return shifts.filter((shift) => shift.userId === selectedUserId);
  }, [shifts, selectedUserId, activeTab]);

  const { todayShifts, thisWeekShifts, nextWeekShifts, week3Shifts, week4Shifts, archiveShifts } =
    useMemo(() => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const baseShifts = activeTab === 'archive' ? shifts : filteredShifts;

      const todayShifts = baseShifts.filter((s) => isToday(getCorrectedLocalDate(s.date)));

      const thisWeekShifts = baseShifts.filter((s) =>
        isSameWeek(getCorrectedLocalDate(s.date), today, { weekStartsOn: 1 })
      );

      const nextWeekShifts = baseShifts.filter((s) => {
        const shiftDate = getCorrectedLocalDate(s.date);
        const startOfNextWeek = addDays(startOfWeek(today, { weekStartsOn: 1 }), 7);
        return isSameWeek(shiftDate, startOfNextWeek, { weekStartsOn: 1 });
      });

      const week3Shifts = baseShifts.filter((s) => {
        const shiftDate = getCorrectedLocalDate(s.date);
        const startOfWeek3 = addDays(startOfWeek(today, { weekStartsOn: 1 }), 14);
        return isSameWeek(shiftDate, startOfWeek3, { weekStartsOn: 1 });
      });

      const week4Shifts = baseShifts.filter((s) => {
        const shiftDate = getCorrectedLocalDate(s.date);
        const startOfWeek4 = addDays(startOfWeek(today, { weekStartsOn: 1 }), 21);
        return isSameWeek(shiftDate, startOfWeek4, { weekStartsOn: 1 });
      });

      const sixWeeksAgo = startOfWeek(subWeeks(today, 5), { weekStartsOn: 1 });
      const historicalShifts = shifts.filter((s) => {
        const shiftDate = getCorrectedLocalDate(s.date);
        return (
          shiftDate >= sixWeeksAgo &&
          shiftDate < startOfWeek(today, { weekStartsOn: 1 }) &&
          ['completed', 'incomplete'].includes(s.status)
        );
      });

      const selectedArchiveDate = startOfWeek(subWeeks(today, parseInt(selectedArchiveWeek)), {
        weekStartsOn: 1,
      });

      const archiveShifts = historicalShifts.filter(
        (s) =>
          isSameWeek(getCorrectedLocalDate(s.date), selectedArchiveDate, { weekStartsOn: 1 }) &&
          (selectedUserId === 'all' || s.userId === selectedUserId)
      );

      return { todayShifts, thisWeekShifts, nextWeekShifts, week3Shifts, week4Shifts, archiveShifts };
    }, [filteredShifts, shifts, selectedUserId, selectedArchiveWeek, activeTab]);

  const userNameMap = useMemo(() => {
    const map = new Map<string, string>();
    users.forEach((user) => map.set(user.uid, user.name));
    return map;
  }, [users]);

  const archiveWeekOptions = useMemo(() => {
    const options: { value: string; label: string }[] = [];
    const today = new Date();
    for (let i = 0; i < 6; i++) {
      const weekStart = startOfWeek(subWeeks(today, i), { weekStartsOn: 1 });
      options.push({
        value: i.toString(),
        label: `w/c ${format(weekStart, 'dd/MM/yy')}`,
      });
    }
    return options;
  }, []);

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
    try {
      await deleteDoc(doc(db, 'shifts', shift.id));
      toast({ title: 'Success', description: 'Shift has been deleted.' });
    } catch (error) {
      console.error('Error deleting shift:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'Could not delete the shift.' });
    }
  };

  const handleDownloadPdf = async (period: 'this' | 'next' | 'both') => {
    const { default: jsPDF } = await import('jspdf');
    const { default: autoTable } = await import('jspdf-autotable');

    const doc = new jsPDF();
    const generationDate = new Date();
    const pageContentMargin = 14;
    const pageHeight = doc.internal.pageSize.height;

    const selectedUser = users.find((u) => u.uid === selectedUserId);
    const title = selectedUser ? `Team Shift Schedule for ${selectedUser.name}` : 'Team Shift Schedule';

    const addPageNumbers = () => {
      const pageCount = doc.internal.pages.length - 1;
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(10);
        doc.setTextColor(150);
        doc.text(
          `Page ${i} of ${pageCount}`,
          doc.internal.pageSize.width - pageContentMargin,
          pageHeight - 10,
          { align: 'right' }
        );
      }
    };

    doc.setFontSize(18);
    doc.text(title, pageContentMargin, 22);
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(`Generated on: ${format(generationDate, 'PPP p')}`, pageContentMargin, 28);

    let finalY = 35;

    const today = new Date();

    const allThisWeekShifts = shifts.filter((s) =>
      isSameWeek(getCorrectedLocalDate(s.date), today, { weekStartsOn: 1 })
    );
    const allNextWeekShifts = shifts.filter((s) => {
      const shiftDate = getCorrectedLocalDate(s.date);
      const startOfNextWeek = addDays(today, 7);
      return isSameWeek(shiftDate, startOfNextWeek, { weekStartsOn: 1 });
    });

    const generateTablesForPeriod = (periodTitle: string, shiftsForPeriod: Shift[]) => {
      if (shiftsForPeriod.length === 0) return;

      const periodFilteredShifts =
        selectedUserId === 'all' ? shiftsForPeriod : shiftsForPeriod.filter((s) => s.userId === selectedUserId);

      if (periodFilteredShifts.length === 0) return;

      if (finalY > 40) finalY += 8;
      doc.setFontSize(16);
      doc.text(periodTitle, pageContentMargin, finalY);
      finalY += 10;

      const shiftsByUser = new Map<string, Shift[]>();
      periodFilteredShifts.forEach((shift) => {
        if (!shiftsByUser.has(shift.userId)) shiftsByUser.set(shift.userId, []);
        shiftsByUser.get(shift.userId)!.push(shift);
      });

      const usersToIterate = selectedUser
        ? [selectedUser]
        : [...users]
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
            .filter((u) => shiftsByUser.has(u.uid));

      for (const user of usersToIterate) {
        const userShifts = shiftsByUser.get(user.uid) || [];
        if (userShifts.length === 0) continue;

        userShifts.sort((a, b) => getCorrectedLocalDate(a.date).getTime() - getCorrectedLocalDate(b.date).getTime());

        const head = [['Date', 'Type', 'Task & Address', 'Status']];
        const body = userShifts.map((shift) => {
          const shiftDate = getCorrectedLocalDate(shift.date);
          const statusText = shift.status.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
          const taskAndAddress = `${shift.task}\n${shift.address}`;
          return {
            date: format(shiftDate, 'EEE, dd MMM'),
            type: shift.type === 'all-day' ? 'All Day' : shift.type.toUpperCase(),
            task: taskAndAddress,
            status: statusText,
            notes:
              (shift.status === 'incomplete' || shift.status === 'rejected') && shift.notes
                ? `Note: ${shift.notes}`
                : null,
          };
        });

        let tableStartY = (doc as any).lastAutoTable ? (doc as any).lastAutoTable.finalY + 15 : finalY;

        const estimatedHeight = 15 + (body.length + 1) * 12;
        if (tableStartY + estimatedHeight > pageHeight - 20) {
          doc.addPage();
          tableStartY = 20;
          finalY = 20;
        }

        if (selectedUserId === 'all') {
          doc.setFontSize(12);
          doc.setFont(doc.getFont().fontName, 'bold');
          doc.text(user.name, pageContentMargin, tableStartY - 5);
          tableStartY += 2;
        }

        autoTable(doc, {
          head,
          body: body.map((row) => [row.date, row.type, row.task, row.status]),
          startY: tableStartY,
          headStyles: { fillColor: [6, 95, 212] },
          didDrawPage: (data) => {
            finalY = data.cursor?.y || 0;
          },
          didParseCell: (data) => {
            if (data.row.index >= 0 && data.section === 'body' && data.column.dataKey === 2) {
              const rowData = body[data.row.index];
              if (rowData?.notes) data.cell.text = [rowData.task, rowData.notes];
            }
          },
          willDrawCell: (data) => {
            if (data.row.index >= 0 && data.section === 'body' && data.column.dataKey === 2) {
              const rowData = body[data.row.index];
              if (rowData?.notes) {
                const textLines = doc.splitTextToSize(rowData.task, data.cell.contentWidth);
                const textHeight = textLines.length * (doc.getLineHeight() / doc.internal.scaleFactor);
                const noteStartY = data.cell.y + textHeight + 1;

                const noteLines = doc.splitTextToSize(rowData.notes, data.cell.contentWidth);
                const noteHeight = noteLines.length * (doc.getLineHeight() / doc.internal.scaleFactor);

                doc.setFillColor(255, 252, 204);
                doc.rect(
                  data.cell.x,
                  noteStartY - (doc.getLineHeight() / doc.internal.scaleFactor) * 0.75,
                  data.cell.width,
                  noteHeight + 2,
                  'F'
                );
              }
            }
          },
        });

        finalY = (doc as any).lastAutoTable.finalY;
      }
    };

    if (period === 'this' || period === 'both') generateTablesForPeriod("This Week's Shifts", allThisWeekShifts);
    if (period === 'next' || period === 'both') generateTablesForPeriod("Next Week's Shifts", allNextWeekShifts);

    if (
      allThisWeekShifts.filter((s) => selectedUserId === 'all' || s.userId === selectedUserId).length === 0 &&
      allNextWeekShifts.filter((s) => selectedUserId === 'all' || s.userId === selectedUserId).length === 0
    ) {
      doc.text('No shifts scheduled for these periods.', pageContentMargin, finalY);
    }

    addPageNumbers();
    doc.save(`team_schedule_${format(generationDate, 'yyyy-MM-dd')}.pdf`);
  };

  const handleDeleteAllShifts = async () => {
    if (!functions) {
      toast({ variant: 'destructive', title: 'Error', description: 'Firebase Functions service is not available.' });
      return;
    }
    setIsDeleting(true);
    toast({ title: 'Deleting All Active Shifts...', description: 'This may take a moment.' });

    try {
      const deleteAllShiftsFn = httpsCallable(functions, 'deleteAllShifts');
      const result = await deleteAllShiftsFn();
      toast({ title: 'Success', description: (result.data as any).message });
    } catch (error: any) {
      console.error('Error deleting all shifts:', error);
      toast({
        variant: 'destructive',
        title: 'Deletion Failed',
        description: error.message || 'An unknown error occurred.',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDownloadDailyReport = async () => {
    const { default: jsPDF } = await import('jspdf');
    const { default: autoTable } = await import('jspdf-autotable');

    const today = new Date();
    const todaysShifts = shifts.filter((s) => isToday(getCorrectedLocalDate(s.date)));

    if (todaysShifts.length === 0) {
      toast({ title: 'No Shifts Today', description: 'There are no shifts scheduled for today to generate a report.' });
      return;
    }

    const doc = new jsPDF();

    const manDaysByManager: { [key: string]: number } = {};
    todaysShifts.forEach((shift) => {
      const manager = shift.manager || 'Unassigned';
      if (!manDaysByManager[manager]) manDaysByManager[manager] = 0;
      if (shift.type === 'all-day') manDaysByManager[manager] += 1;
      else if (shift.type === 'am' || shift.type === 'pm') manDaysByManager[manager] += 0.5;
    });

    const totalShifts = todaysShifts.length;
    const completed = todaysShifts.filter((s) => s.status === 'completed').length;
    const pending = todaysShifts.filter((s) => s.status === 'pending-confirmation').length;
    const confirmed = todaysShifts.filter((s) => s.status === 'confirmed').length;
    const onSite = todaysShifts.filter((s) => s.status === 'on-site').length;
    const incomplete = todaysShifts.filter((s) => s.status === 'incomplete').length;
    const operatives = new Set(todaysShifts.map((s) => s.userId)).size;

    doc.setFontSize(18);
    doc.text(`Daily Report for ${format(today, 'PPP')}`, 14, 22);

    let lastY = 25;

    doc.setFontSize(12);
    doc.text('Man-Days per Manager:', 14, lastY + 10);
    autoTable(doc, {
      startY: lastY + 14,
      head: [['Manager', 'Total Man-Days']],
      body: Object.entries(manDaysByManager).map(([manager, days]) => [manager, days.toFixed(1)]),
      theme: 'striped',
      headStyles: { fillColor: [100, 100, 100] },
    });
    lastY = (doc as any).lastAutoTable.finalY;

    doc.text("Summary of Today's Activities:", 14, lastY + 10);
    autoTable(doc, {
      startY: lastY + 14,
      body: [
        ['Total Shifts', totalShifts],
        ['Operatives on Site', operatives],
        ['Completed Shifts', completed],
        ['On Site / In Progress', onSite],
        ['Confirmed', confirmed],
        ['Pending Confirmation', pending],
        ['Marked Incomplete', incomplete],
      ],
      theme: 'grid',
      styles: { fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 50 }, 1: { cellWidth: 'auto', halign: 'center' } },
    });

    doc.save(`daily_report_${format(today, 'yyyy-MM-dd')}.pdf`);
  };

  const handleDownloadWeeklyReport = async () => {
    const { default: jsPDF } = await import('jspdf');
    const { default: autoTable } = await import('jspdf-autotable');

    const today = new Date();
    const start = startOfWeek(today, { weekStartsOn: 1 });
    const end = endOfWeek(today, { weekStartsOn: 1 });

    const weeklyShifts = shifts.filter((s) => {
      const shiftDate = getCorrectedLocalDate(s.date);
      return shiftDate >= start && shiftDate <= end;
    });

    if (weeklyShifts.length === 0) {
      toast({ title: 'No Shifts This Week', description: 'There are no shifts scheduled for the current week.' });
      return;
    }

    const doc = new jsPDF();

    const manDaysByManager: { [key: string]: number } = {};
    weeklyShifts.forEach((shift) => {
      const manager = shift.manager || 'Unassigned';
      if (!manDaysByManager[manager]) manDaysByManager[manager] = 0;
      if (shift.type === 'all-day') manDaysByManager[manager] += 1;
      else if (shift.type === 'am' || shift.type === 'pm') manDaysByManager[manager] += 0.5;
    });

    doc.setFontSize(18);
    doc.text(`Weekly Report: ${format(start, 'dd MMM')} - ${format(end, 'dd MMM yyyy')}`, 14, 22);

    let lastY = 25;

    doc.setFontSize(12);
    doc.text('Man-Days per Manager:', 14, lastY + 10);
    autoTable(doc, {
      startY: lastY + 14,
      head: [['Manager', 'Total Man-Days']],
      body: Object.entries(manDaysByManager).map(([manager, days]) => [manager, days.toFixed(1)]),
      theme: 'striped',
      headStyles: { fillColor: [100, 100, 100] },
    });
    lastY = (doc as any).lastAutoTable.finalY;

    autoTable(doc, {
      startY: lastY + 14,
      head: [['Date', 'Operative', 'Task', 'Address', 'Status']],
      body: weeklyShifts
        .slice()
        .sort((a, b) => getCorrectedLocalDate(a.date).getTime() - getCorrectedLocalDate(b.date).getTime())
        .map((shift) => [
          format(getCorrectedLocalDate(shift.date), 'EEE, dd/MM'),
          userNameMap.get(shift.userId) || 'Unknown',
          shift.task,
          shift.address,
          shift.status.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
        ]),
      headStyles: { fillColor: [6, 95, 212] },
      styles: { cellPadding: 2, fontSize: 8, valign: 'middle' },
      rowPageBreak: 'auto',
    });

    doc.save(`weekly_report_${format(today, 'yyyy-MM-dd')}.pdf`);
  };

  const renderShiftList = (shiftsToRender: Shift[]) => {
    if (shiftsToRender.length === 0) return null;

    const truncate = (text: string, length = 10) => {
      const words = text.split(' ');
      return words.length > length ? words.slice(0, length).join(' ') + '...' : text;
    };

    return (
      <>
        <Card className="hidden md:block mt-4">
          <CardContent className="p-0">
            <TooltipProvider>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[180px]">Date</TableHead>
                    {(selectedUserId === 'all' || activeTab === 'archive') && (
                      <TableHead className="w-[180px]">Operative</TableHead>
                    )}
                    <TableHead>Task &amp; Address</TableHead>
                    <TableHead>Manager</TableHead>
                    <TableHead className="text-right w-[110px]">Type</TableHead>
                    <TableHead className="text-right w-[160px]">Status</TableHead>
                    {isOwner && <TableHead className="text-right w-[140px]">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shiftsToRender.map((shift) => (
                    <TableRow key={shift.id}>
                      <TableCell className="font-medium">
                        {format(getCorrectedLocalDate(shift.date), 'eeee, MMM d')}
                      </TableCell>
                      {(selectedUserId === 'all' || activeTab === 'archive') && (
                        <TableCell>{userNameMap.get(shift.userId) || 'Unknown'}</TableCell>
                      )}
                      <TableCell>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="truncate">{truncate(shift.task)}</div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="max-w-xs">{shift.task}</p>
                          </TooltipContent>
                        </Tooltip>
                        <div className="text-xs text-muted-foreground">{shift.address}</div>
                        {shift.eNumber && (
                          <div className="text-xs text-muted-foreground">E-Number: {shift.eNumber}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{shift.manager || 'N/A'}</TableCell>
                      <TableCell className="text-right">
                        <Badge
                          variant={shift.type === 'am' ? 'default' : shift.type === 'pm' ? 'secondary' : 'outline'}
                          className="capitalize text-xs"
                        >
                          {shift.type === 'all-day' ? 'All Day' : shift.type.toUpperCase()}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{getStatusBadge(shift)}</TableCell>

                      {isOwner && (
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEditShift(shift)}>
                            <Edit className="h-4 w-4" />
                          </Button>

                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive/70 hover:text-destructive hover:bg-destructive/10"
                              >
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
                                <AlertDialogAction
                                  onClick={() => handleDeleteShift(shift)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
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
            </TooltipProvider>
          </CardContent>
        </Card>
      </>
    );
  };

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

        const typeOrder = { am: 1, pm: 2, 'all-day': 3 } as const;
        return typeOrder[a.type] - typeOrder[b.type];
      });
    };

    const activeShifts = sortShifts(
      weekShifts.filter((s) => ['pending-confirmation', 'confirmed', 'on-site', 'rejected'].includes(s.status))
    );

    const historicalShifts = sortShifts(weekShifts.filter((s) => ['completed', 'incomplete'].includes(s.status))).sort(
      (a, b) => getCorrectedLocalDate(b.date).getTime() - getCorrectedLocalDate(a.date).getTime()
    );

    if (activeShifts.length === 0 && historicalShifts.length === 0) {
      return (
        <div className="h-24 text-center flex items-center justify-center text-muted-foreground mt-4 border border-dashed rounded-lg">
          No shifts scheduled for this period.
        </div>
      );
    }

    return (
      <>
        {activeShifts.length > 0 ? (
          renderShiftList(activeShifts)
        ) : (
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

  const renderArchiveView = () => {
    if (loading) {
      return (
        <div className="border rounded-lg overflow-hidden mt-4">
          <Skeleton className="h-48 w-full" />
        </div>
      );
    }

    const sortedShifts = [...archiveShifts].sort((a, b) => {
      const dateA = getCorrectedLocalDate(a.date).getTime();
      const dateB = getCorrectedLocalDate(b.date).getTime();
      if (dateA !== dateB) return dateB - dateA;

      const nameA = userNameMap.get(a.userId) || '';
      const nameB = userNameMap.get(b.userId) || '';
      if (nameA !== nameB) return nameA.localeCompare(nameB);

      const typeOrder = { am: 1, pm: 2, 'all-day': 3 } as const;
      return typeOrder[a.type] - typeOrder[b.type];
    });

    if (sortedShifts.length === 0) {
      return (
        <div className="h-24 text-center flex items-center justify-center text-muted-foreground mt-4 border border-dashed rounded-lg">
          No archived shifts found for this user and week.
        </div>
      );
    }

    return renderShiftList(sortedShifts);
  };

  if (error) {
    return (
      <Alert variant="destructive">
        <Terminal className="h-4 w-4" />
        <AlertTitle>Error Loading Schedule</AlertTitle>
        <AlertDescription style={{ whiteSpace: 'pre-wrap' }}>{error}</AlertDescription>
      </Alert>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <CardTitle>Team Schedule Overview</CardTitle>
              <CardDescription>A list of all upcoming shifts for the team, which updates in real-time.</CardDescription>
            </div>

            <div className="flex items-center gap-2 shrink-0 flex-wrap justify-start sm:justify-end">
              <Button variant="outline" onClick={() => router.push('/site-schedule')}>
                <Building className="mr-2 h-4 w-4" />
                Site View
              </Button>

              <Button variant="outline" size="sm" onClick={handleDownloadDailyReport}>
                <BarChart2 className="mr-2 h-4 w-4" />
                Daily Report
              </Button>

              <Button variant="outline" size="sm" onClick={handleDownloadWeeklyReport}>
                <Calendar className="mr-2 h-4 w-4" />
                Weekly Report
              </Button>

              {isOwner && (
                <div className="flex items-center gap-2">
                  <Button onClick={handleAddShift}>
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Add Shift
                  </Button>

                  <AlertDialog>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="icon" className="h-10 w-10">
                          <CircleEllipsis />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <AlertDialogTrigger asChild>
                          <DropdownMenuItem
                            className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                            disabled={isDeleting}
                          >
                            <Trash className="mr-2" /> Delete All Active
                          </DropdownMenuItem>
                        </AlertDialogTrigger>
                      </DropdownMenuContent>
                    </DropdownMenu>

                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will permanently delete all active (published) shifts. Completed and incomplete shifts will
                          not be affected. This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={handleDeleteAllShifts}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          {isDeleting ? 'Deleting...' : 'Yes, Delete Active Shifts'}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              )}
            </div>
          </div>

          <div className="pt-4 flex flex-col sm:flex-row gap-4 items-center">
            <div className="flex-grow w-full sm:w-auto">
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger className="w-full sm:w-[250px]">
                  <SelectValue placeholder="All Users" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Users</SelectItem>
                  {users.map((user) => (
                    <SelectItem key={user.uid} value={user.uid}>
                      {user.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {activeTab !== 'archive' && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" disabled={loading} className="w-full sm:w-auto">
                    <Download className="mr-2 h-4 w-4" />
                    Download PDF
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onClick={() => handleDownloadPdf('this')}>This Week</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleDownloadPdf('next')}>Next Week</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleDownloadPdf('both')}>Both Weeks</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </CardHeader>

        <CardContent>
          <Tabs defaultValue="today" onValueChange={setActiveTab}>
            <div className="flex flex-col space-y-2">
              <TabsList className="grid grid-cols-3">
                <TabsTrigger value="today">Today</TabsTrigger>
                <TabsTrigger value="this-week">This Week</TabsTrigger>
                <TabsTrigger value="next-week">Next Week</TabsTrigger>
              </TabsList>
              <TabsList className="grid grid-cols-3">
                <TabsTrigger value="week-3">Week 3</TabsTrigger>
                <TabsTrigger value="week-4">Week 4</TabsTrigger>
                <TabsTrigger value="archive">Archive</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="today" className="mt-4">
              {renderWeekSchedule(todayShifts)}
            </TabsContent>
            <TabsContent value="this-week" className="mt-4">
              {renderWeekSchedule(thisWeekShifts)}
            </TabsContent>
            <TabsContent value="next-week" className="mt-4">
              {renderWeekSchedule(nextWeekShifts)}
            </TabsContent>
            <TabsContent value="week-3" className="mt-4">
              {renderWeekSchedule(week3Shifts)}
            </TabsContent>
            <TabsContent value="week-4" className="mt-4">
              {renderWeekSchedule(week4Shifts)}
            </TabsContent>
            <TabsContent value="archive" className="mt-4">
              <div className="flex flex-col sm:flex-row gap-4 items-center bg-muted/50 p-4 rounded-lg">
                <p className="text-sm font-medium text-muted-foreground">
                  View completed and incomplete shifts from the last 6 weeks.
                </p>
                <Select value={selectedArchiveWeek} onValueChange={setSelectedArchiveWeek}>
                  <SelectTrigger className="w-full sm:w-[250px]">
                    <SelectValue placeholder="Select a week" />
                  </SelectTrigger>
                  <SelectContent>
                    {archiveWeekOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {renderArchiveView()}
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
          userProfile={userProfile}
        />
      )}
    </>
  );
}
