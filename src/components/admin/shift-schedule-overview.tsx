'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  collection,
  onSnapshot,
  query,
  doc,
  where,
  getDocs,
  updateDoc,
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
  subDays,
  startOfToday,
  isSameDay,
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
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useAuth } from '@/hooks/use-auth';
import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/shared/spinner';
import { useDepartmentFilter } from '@/hooks/use-department-filter';
import { useAllUsers } from '@/hooks/use-all-users';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  MessageSquareText,
  PlusCircle,
  Edit,
  Trash2,
  Download,
  History,
  Building,
  BarChart2,
  HardHat,
  ThumbsDown,
  Users,
  ChevronRight,
  Calendar as CalendarIcon,
  MapPin,
  FileText,
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { cn } from '@/lib/utils';

/**
 * 🔒 ROBUST NORMALIZATION
 */
const normalizeAddress = (addr: string | null | undefined): string => {
  if (!addr) return "";
  return String(addr)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const getStatusBadge = (shift: Shift) => {
  const baseProps = { className: 'capitalize' };
  switch (shift.status) {
    case 'pending-confirmation':
      return <Badge variant="secondary" {...baseProps}>Pending</Badge>;
    case 'confirmed':
      return <Badge {...baseProps}>Confirmed</Badge>;
    case 'on-site':
      return <Badge {...baseProps} className="bg-teal-500 hover:bg-teal-600"><HardHat className="mr-1.5 h-3 w-3" />On Site</Badge>;
    case 'completed':
      return <Badge {...baseProps} className="bg-green-600 hover:bg-green-700 text-white">Completed</Badge>;
    case 'rejected':
      return (
        <div className="flex items-center gap-1 justify-end">
          <Badge variant="destructive" {...baseProps}><ThumbsDown className="mr-1.5 h-3 w-3" />Rejected</Badge>
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
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{shift.notes}</p>
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
  const { user } = useAuth();
  const [allShifts, setAllShifts] = useState<Shift[]>([]);
  const { users: allUsers, loading: usersLoading } = useAllUsers();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedShift, setSelectedShift] = useState<Shift | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string>('all');
  const [selectedArchiveWeek, setSelectedArchiveWeek] = useState<string>('0');
  const [activeTab, setActiveTab] = useState('today');
  const [isConfirmDeleteAllOpen, setIsConfirmDeleteAllOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [reauthError, setReauthError] = useState<string | null>(null);
  const [isReauthenticating, setIsReauthenticating] = useState(false);
  const { toast } = useToast();
  const router = useRouter();
  
  const [viewMode, setViewMode] = useState<'user' | 'site'>('user');
  const [selectedSiteAddress, setSelectedSiteAddress] = useState<string>('');
  const [siteTimeFrame, setSiteTimeFrame] = useState<'1w' | '2w' | 'all'>('all');

  const { selectedDepartments } = useDepartmentFilter();
  const isOwner = userProfile.role === 'owner';
  const isPhil = userProfile?.email === 'phil.s@broadoakgroup.com';
  const isPrivilegedForPlanner = ['admin', 'owner', 'manager'].includes(userProfile.role);

  useEffect(() => {
    if (!db) {
      setLoading(false);
      setError("Firebase is not configured.");
      return;
    }
    
    let shiftsQuery;
    if (isOwner) {
        shiftsQuery = query(collection(db, 'shifts'));
    } else if (userProfile.department) {
        shiftsQuery = query(collection(db, 'shifts'), where('department', '==', userProfile.department));
    } else {
        shiftsQuery = query(collection(db, 'shifts'), where('userId', '==', userProfile.uid));
    }
    
    const unsubShifts = onSnapshot(shiftsQuery, (snapshot) => {
      setAllShifts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Shift)));
      setLoading(false);
    }, (err) => {
      console.error("Error fetching shifts: ", err);
      setError('Failed to fetch schedule.');
      setLoading(false);
    });

    const projectsQuery = query(collection(db, 'projects'));
    const unsubProjects = onSnapshot(projectsQuery, (snapshot) => {
        setProjects(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)));
    });

    return () => {
      unsubShifts();
      unsubProjects();
    };
  }, [isOwner, userProfile.uid, userProfile.department]);

  const getCorrectedLocalDate = (date: { toDate: () => Date }) => {
    const d = date.toDate();
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  };

  /**
   * 🔒 CENTRAL SHIFT FILTER
   * Respects user role, assigned department, and Owner's department filter.
   */
  const shiftsForCurrentView = useMemo(() => {
    if (isOwner) {
      if (selectedDepartments.size > 0) {
        return allShifts.filter(shift => shift.department && selectedDepartments.has(shift.department));
      }
      return allShifts;
    }
    return allShifts;
  }, [allShifts, isOwner, selectedDepartments]);
  
  const {
    usersForDropdown,
    todayShifts,
    thisWeekShifts,
    lastWeekShifts,
    nextWeekShifts,
    archiveShifts,
  } = useMemo(() => {
    const today = startOfToday();

    const userIdsWithCurrentShifts = new Set<string>();
    shiftsForCurrentView.forEach(shift => {
      if (getCorrectedLocalDate(shift.date) >= today) {
        userIdsWithCurrentShifts.add(shift.userId);
      }
    });

    const usersInSelectedDepartments = allUsers.filter(u => {
      if (isOwner) {
        if (selectedDepartments.size === 0) return true;
        return u.department && selectedDepartments.has(u.department);
      }
      if (userProfile.department) {
        return u.department === userProfile.department;
      }
      return u.uid === userProfile.uid;
    });
    
    const combinedUsers = new Map<string, UserProfile>();
    usersInSelectedDepartments.forEach(u => combinedUsers.set(u.uid, u));
    userIdsWithCurrentShifts.forEach(uid => {
      if (!combinedUsers.has(uid)) {
        const crossDeptUser = allUsers.find(u => u.uid === uid);
        if (crossDeptUser) combinedUsers.set(uid, crossDeptUser);
      }
    });

    const usersForDropdownResult = Array.from(combinedUsers.values()).sort((a, b) => a.name.localeCompare(b.name));
    
    const finalFilteredShifts = selectedUserId === 'all'
      ? shiftsForCurrentView
      : shiftsForCurrentView.filter(s => s.userId === selectedUserId);

    const shiftsToday = finalFilteredShifts
      .filter(s => isToday(getCorrectedLocalDate(s.date)))
      .sort((a, b) => getCorrectedLocalDate(a.date).getTime() - getCorrectedLocalDate(b.date).getTime());

    const shiftsThisWeek = finalFilteredShifts
        .filter(s => isSameWeek(getCorrectedLocalDate(s.date), today, { weekStartsOn: 1 }))
        .sort((a, b) => getCorrectedLocalDate(a.date).getTime() - getCorrectedLocalDate(b.date).getTime());

    const startOfLastWeek = startOfWeek(subDays(today, 7), {
      weekStartsOn: 1,
    });
    const shiftsLastWeek = finalFilteredShifts
      .filter(s => isSameWeek(getCorrectedLocalDate(s.date), startOfLastWeek, { weekStartsOn: 1 }))
      .sort((a, b) => getCorrectedLocalDate(a.date).getTime() - getCorrectedLocalDate(b.date).getTime());

    const shiftsNextWeek = finalFilteredShifts
      .filter(s => isSameWeek(getCorrectedLocalDate(s.date), addDays(today, 7), { weekStartsOn: 1 }))
      .sort((a, b) => getCorrectedLocalDate(a.date).getTime() - getCorrectedLocalDate(b.date).getTime());
  
    // 🔒 ARCHIVE VISIBILITY FIX: Show all shifts in the selected week, not just completed ones.
    const selectedArchiveDate = startOfWeek(subWeeks(today, parseInt(selectedArchiveWeek)), { weekStartsOn: 1 });
    const finalArchiveShifts = finalFilteredShifts
      .filter(s => isSameWeek(getCorrectedLocalDate(s.date), selectedArchiveDate, { weekStartsOn: 1 }))
      .sort((a, b) => getCorrectedLocalDate(a.date).getTime() - getCorrectedLocalDate(b.date).getTime());
  
    return {
      usersForDropdown: usersForDropdownResult,
      todayShifts: shiftsToday,
      thisWeekShifts: shiftsThisWeek,
      lastWeekShifts: shiftsLastWeek,
      nextWeekShifts: shiftsNextWeek,
      archiveShifts: finalArchiveShifts
    };
  
  }, [shiftsForCurrentView, allUsers, isOwner, selectedDepartments, selectedUserId, userProfile.department, userProfile.uid, selectedArchiveWeek]);

  const userNameMap = useMemo(() => {
    const map = new Map<string, string>();
    allUsers.forEach(user => map.set(user.uid, user.name));
    return map;
  }, [allUsers]);

  const archiveWeekOptions = useMemo(() => {
    const options = [];
    const today = new Date();
    // 🔒 HISTORY EXPANSION: Now goes back 52 weeks (1 year)
    for (let i = 0; i < 52; i++) {
      const weekStart = startOfWeek(subWeeks(today, i), { weekStartsOn: 1 });
      options.push({
        value: i.toString(),
        label: `w/c ${format(weekStart, 'dd/MM/yy')}`
      });
    }
    return options;
  }, []);
  
  /**
   * 🔒 COLLATED SITE ADDRESSES
   */
  const uniqueSiteAddresses = useMemo(() => {
    const addressMap = new Map<string, string>();
    shiftsForCurrentView.forEach(shift => {
        if(shift.address) {
            const key = normalizeAddress(shift.address);
            if (!addressMap.has(key)) {
                addressMap.set(key, shift.address);
            } else {
                const existing = addressMap.get(key)!;
                if (shift.address.includes(',') && !existing.includes(',')) {
                    addressMap.set(key, shift.address);
                } else if (shift.address.length > existing.length && (!existing.includes(',') || shift.address.includes(','))) {
                    addressMap.set(key, shift.address);
                }
            }
        }
    });
    return Array.from(addressMap.values()).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [shiftsForCurrentView]);

  const siteScheduleShifts = useMemo(() => {
    if (!selectedSiteAddress) return [];
    
    const targetKey = normalizeAddress(selectedSiteAddress);
    const siteShifts = shiftsForCurrentView.filter(s => normalizeAddress(s.address) === targetKey);
    
    let filteredByDate = siteShifts;

    if (siteTimeFrame !== 'all') {
      const today = startOfToday();
      const endDate = addDays(today, siteTimeFrame === '1w' ? 7 : 14);
      filteredByDate = siteShifts.filter(s => {
          const shiftDate = getCorrectedLocalDate(s.date);
          return shiftDate >= today && shiftDate < endDate;
      });
    }
    
    return filteredByDate.sort((a,b) => getCorrectedLocalDate(a.date).getTime() - getCorrectedLocalDate(b.date).getTime());
  }, [selectedSiteAddress, shiftsForCurrentView, siteTimeFrame]);


  const handleAddShift = () => {
    setSelectedShift(null);
    setIsFormOpen(true);
  };
  
  const handleEditShift = (shift: Shift) => {
    setSelectedShift(shift);
    setIsFormOpen(true);
  };
  
  const handleDeleteShift = async (shift: Shift) => {
    if (!functions) {
        toast({ variant: 'destructive', title: 'Functions not available' });
        return;
    }
    try {
        const deleteShiftFn = httpsCallable<{ shiftId: string }, { success: boolean }>(functions, 'deleteShift');
        await deleteShiftFn({ shiftId: shift.id });
        toast({ title: 'Success', description: 'Shift has been deleted.' });
    } catch (error: any) {
        console.error("Error deleting shift:", error);
        toast({ variant: 'destructive', title: 'Error', description: error.message || 'Could not delete the shift.' });
    }
  };

  const handleDownloadPdf = async (period: 'this' | 'next' | 'both') => {
    const { default: jsPDF } = await import('jspdf');
    const { default: autoTable } = await import('jspdf-autotable');

    const doc = new jsPDF();
    const generationDate = new Date();
    const pageContentMargin = 14;
    const pageHeight = doc.internal.pageSize.height;
    
    const selectedUser = allUsers.find(u => u.uid === selectedUserId);
    const title = selectedUser ? `Team Shift Schedule for ${selectedUser.name}` : 'Team Shift Schedule';

    const addPageNumbers = () => {
        const pageCount = (doc.internal as any).pages.length - 1;
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setFontSize(10);
            doc.setTextColor(150);
            doc.text(`Page ${i} of ${pageCount}`, doc.internal.pageSize.width - pageContentMargin, pageHeight - 10, { align: 'right' });
        }
    };

    doc.setFontSize(18);
    doc.text(title, pageContentMargin, 22);
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(`Generated on: ${format(generationDate, 'PPP p')}`, pageContentMargin, 28);

    let finalY = 35;
    const today = new Date();

    const allThisWeekShifts = shiftsForCurrentView.filter(s => isSameWeek(getCorrectedLocalDate(s.date), today, { weekStartsOn: 1 }));
    const allNextWeekShifts = shiftsForCurrentView.filter(s => {
        const shiftDate = getCorrectedLocalDate(s.date);
        const startOfNextWeek = addDays(today, 7);
        return isSameWeek(shiftDate, startOfNextWeek, { weekStartsOn: 1 });
    });

    const generateTablesForPeriod = (periodTitle: string, shiftsForPeriod: Shift[]) => {
        if (shiftsForPeriod.length === 0) return;
        
        const periodFilteredShifts = selectedUserId === 'all'
            ? shiftsForPeriod
            : shiftsForPeriod.filter(s => s.userId === selectedUserId);

        if (periodFilteredShifts.length === 0) return;

        if (finalY > 40) finalY += 8;
        doc.setFontSize(16);
        doc.text(periodTitle, pageContentMargin, finalY);
        finalY += 10;
        
        const shiftsByUser = new Map<string, Shift[]>();
        periodFilteredShifts.forEach(shift => {
            if (!shiftsByUser.has(shift.userId)) shiftsByUser.set(shift.userId, []);
            shiftsByUser.get(shift.userId)!.push(shift);
        });

        const usersToIterate = selectedUser ? [selectedUser] : [...allUsers].sort((a, b) => (a.name || '').localeCompare(b.name || '')).filter(u => shiftsByUser.has(u.uid));
        
        for (const user of usersToIterate) {
            const userShifts = shiftsByUser.get(user.uid) || [];
            if (userShifts.length === 0) continue;

            userShifts.sort((a, b) => getCorrectedLocalDate(a.date).getTime() - getCorrectedLocalDate(b.date).getTime());
            
            const head = [['Date', 'Type', 'Task & Address', 'Status']];
            const body = userShifts.map(shift => {
                const statusText = shift.status.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                let taskAndAddress = `${shift.task}\n${shift.address}`;
                return {
                    date: format(getCorrectedLocalDate(shift.date), 'EEE, dd MMM'),
                    type: shift.type === 'all-day' ? 'All Day' : shift.type.toUpperCase(),
                    task: taskAndAddress,
                    status: statusText,
                    notes: ((shift.status === 'incomplete' || shift.status === 'rejected') && shift.notes) ? `Note: ${shift.notes}` : null,
                };
            });
            
            let tableStartY = (doc as any).lastAutoTable ? (doc as any).lastAutoTable.finalY + 15 : finalY;
            if (tableStartY + 30 > pageHeight - 20) {
                doc.addPage();
                tableStartY = 20;
            }
            
            if (selectedUserId === 'all') {
                doc.setFontSize(12);
                doc.setFont(doc.getFont().fontName, 'bold');
                doc.text(user.name, pageContentMargin, tableStartY - 5);
                tableStartY += 2; 
            }

            autoTable(doc, {
                head,
                body: body.map(row => [row.date, row.type, row.task, row.status]),
                startY: tableStartY,
                headStyles: { fillColor: [6, 95, 212] },
                didDrawPage: (data: any) => { finalY = data.cursor?.y || 0; },
                didParseCell: (data) => {
                    if (data.row.index >= 0 && data.section === 'body' && data.column.dataKey === 2) {
                        const rowData = body[data.row.index];
                        if (rowData?.notes) (data.cell.text as any) = [rowData.task, rowData.notes];
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
                            doc.rect( data.cell.x, noteStartY - (doc.getLineHeight() / doc.internal.scaleFactor) * 0.75, data.cell.width, noteHeight + 2, 'F');
                        }
                    }
                },
            });
            finalY = (doc as any).lastAutoTable.finalY;
        }
    };

    if (period === 'this' || period === 'both') generateTablesForPeriod("This Week's Shifts", allThisWeekShifts);
    if (period === 'next' || period === 'both') generateTablesForPeriod("Next Week's Shifts", allNextWeekShifts);
    
    addPageNumbers();
    doc.save(`team_schedule_${format(generationDate, 'yyyy-MM-dd')}.pdf`);
  };

  const handleDownloadSiteReport = async () => {
    if (!selectedSiteAddress || siteScheduleShifts.length === 0) {
        toast({ title: 'No Data to Export', description: 'No shifts found for the selected site.' });
        return;
    }

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.width;
    const pageMargin = 15;
    
    doc.setFillColor(241, 245, 249);
    doc.rect(0, 0, pageWidth, 28, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(15, 23, 42);
    doc.text('BROAD OAK GROUP', pageMargin, 17);
    
    let currentY = 40;
    doc.setFontSize(22);
    doc.text('Plan of Works', pageMargin, currentY);
    currentY += 10;

    doc.setFontSize(14);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(51, 65, 85);
    const addressLines = doc.splitTextToSize(selectedSiteAddress, pageWidth - (pageMargin * 2));
    doc.text(addressLines, pageMargin, currentY);
    currentY += (addressLines.length * 6) + 10;
    
    doc.setFontSize(9);
    doc.setTextColor(148, 163, 184);
    doc.text(`Report generated on: ${format(new Date(), 'PPP')}`, pageMargin, currentY);
    currentY += 10;
    
    autoTable(doc, {
      startY: currentY,
      head: [['Date', 'Task', 'Operative']],
      body: siteScheduleShifts.map(shift => [
        format(getCorrectedLocalDate(shift.date), 'eeee, MMM d, yyyy'),
        shift.task,
        userNameMap.get(shift.userId) || 'Unknown'
      ]),
      theme: 'grid',
      headStyles: { fillColor: [6, 95, 212] },
    });
    
    doc.save(`site_schedule_${selectedSiteAddress.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`);
  };

  const handleDownloadDailyReport = async () => {
    const { default: jsPDF } = await import('jspdf');
    const { default: autoTable } = await import('jspdf-autotable');

    const today = startOfToday();
    const currentTodayShifts = shiftsForCurrentView.filter(s => isSameDay(getCorrectedLocalDate(s.date), today));

    if (currentTodayShifts.length === 0) {
      toast({ title: 'No shifts scheduled for today.' });
      return;
    }

    const doc = new jsPDF();
    const generationDate = new Date();

    doc.setFontSize(18);
    doc.text(`Daily Shift Report - ${format(today, 'PPP')}`, 14, 22);
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(`Generated on: ${format(generationDate, 'PPP p')}`, 14, 28);

    let finalY = 35;
    const shiftsByUser = new Map<string, Shift[]>();
    currentTodayShifts.forEach(shift => {
        if (!shiftsByUser.has(shift.userId)) shiftsByUser.set(shift.userId, []);
        shiftsByUser.get(shift.userId)!.push(shift);
    });

    const usersWithShiftsToday = [...allUsers]
        .filter(u => shiftsByUser.has(u.uid))
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    for (const user of usersWithShiftsToday) {
        const userShifts = shiftsByUser.get(user.uid) || [];
        userShifts.sort((a, b) => {
            const typeOrder = { 'am': 1, 'pm': 2, 'all-day': 3 };
            return typeOrder[a.type as keyof typeof typeOrder] - typeOrder[b.type as keyof typeof typeOrder];
        });

        doc.setFontSize(14);
        doc.setFont(doc.getFont().fontName, 'bold');
        doc.text(user.name, 14, finalY + 10);

        autoTable(doc, {
            head: [['Type', 'Task & Address', 'Status']],
            body: userShifts.map(shift => [
                shift.type === 'all-day' ? 'All Day' : shift.type.toUpperCase(),
                `${shift.task}\n${shift.address}`,
                shift.status.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
            ]),
            startY: finalY + 14,
            headStyles: { fillColor: [6, 95, 212] },
        });
        finalY = (doc as any).lastAutoTable.finalY;
    }

    doc.save(`daily_report_${format(today, 'yyyy-MM-dd')}.pdf`);
  };

  const handlePasswordConfirmedDeleteAll = async () => {
    if (!user || !user.email) return;
    if (!password) { setReauthError('Password is required.'); return; }
    setIsReauthenticating(true);
    try {
      const credential = EmailAuthProvider.credential(user.email, password);
      await reauthenticateWithCredential(user, credential);
      const deleteAllShiftsFn = httpsCallable(functions!, 'deleteAllShifts');
      await deleteAllShiftsFn();
      toast({ title: 'Success', description: 'Active shifts deleted.' });
      setIsConfirmDeleteAllOpen(false);
    } catch (error) { setReauthError('Incorrect password.'); } 
    finally { setIsReauthenticating(false); setPassword(''); }
  };

  const renderShiftList = (shiftsToRender: Shift[]) => {
    if (shiftsToRender.length === 0) {
      return <div className="h-24 text-center flex items-center justify-center text-muted-foreground mt-4 border border-dashed rounded-lg">No shifts scheduled.</div>;
    }
    const sortedShifts = [...shiftsToRender].sort((a,b) => getCorrectedLocalDate(a.date).getTime() - getCorrectedLocalDate(b.date).getTime());
    
    // Logic to determine if we should show the Operative info
    const showOperative = selectedUserId === 'all' || viewMode === 'site' || activeTab === 'archive';

    return (
        <>
            <Card className="hidden md:block mt-4">
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[180px]">Date</TableHead>
                                { showOperative && <TableHead className="w-[180px]">Operative</TableHead> }
                                <TableHead>Task &amp; Address</TableHead>
                                <TableHead>Manager</TableHead>
                                { isPrivilegedForPlanner && <TableHead>Planner</TableHead> }
                                <TableHead className="text-right w-[110px]">Type</TableHead>
                                <TableHead className="text-right w-[160px]">Status</TableHead>
                                {isOwner && <TableHead className="text-right w-[140px]">Actions</TableHead>}
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {sortedShifts.map(shift => (
                                <TableRow key={shift.id}>
                                    <TableCell className="font-medium">{format(getCorrectedLocalDate(shift.date), 'eeee, MMM d')}</TableCell>
                                    { showOperative && <TableCell>{userNameMap.get(shift.userId) || 'Unknown'}</TableCell> }
                                    <TableCell>
                                        <div className="font-medium whitespace-pre-wrap">{shift.task}</div>
                                        <a href={`https://maps.google.com/?q=${encodeURIComponent(shift.address)}`} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:underline block whitespace-pre-wrap">{shift.address}</a>
                                        {shift.eNumber && <div className="text-xs text-muted-foreground">{shift.eNumber}</div>}
                                    </TableCell>
                                    <TableCell className="text-xs text-muted-foreground">{shift.manager || 'N/A'}</TableCell>
                                    { isPrivilegedForPlanner && (
                                        <TableCell className="text-xs text-muted-foreground">
                                            {shift.department === 'Gas' ? (shift.plannerName || 'Manual') : '—'}
                                        </TableCell>
                                    )}
                                    <TableCell className="text-right">
                                        <Badge variant={shift.type === 'am' ? 'default' : 'outline'} className={cn("capitalize text-xs", shift.type === 'pm' && "bg-purple-500 text-white border-transparent")}>{shift.type === 'all-day' ? 'All Day' : shift.type.toUpperCase()}</Badge>
                                    </TableCell>
                                    <TableCell className="text-right">{getStatusBadge(shift)}</TableCell>
                                    {isOwner && (
                                        <TableCell className="text-right">
                                            <div className="flex justify-end gap-1">
                                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEditShift(shift)}><Edit className="h-4 w-4" /></Button>
                                                {isPhil && (
                                                    <AlertDialog>
                                                        <AlertDialogTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8 text-destructive/70"><Trash2 className="h-4 w-4" /></Button></AlertDialogTrigger>
                                                        <AlertDialogContent>
                                                            <AlertDialogHeader><AlertDialogTitle>Delete Shift?</AlertDialogTitle><AlertDialogDescription>This action cannot be undone.</AlertDialogDescription></AlertDialogHeader>
                                                            <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => handleDeleteShift(shift)} className="bg-destructive">Delete</AlertDialogAction></AlertDialogFooter>
                                                        </AlertDialogContent>
                                                    </AlertDialog>
                                                )}
                                            </div>
                                        </TableCell>
                                    )}
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
            <div className="space-y-4 md:hidden mt-4">
                {sortedShifts.map(shift => (
                   <Card key={shift.id}>
                        <CardHeader className="p-4 pb-2">
                            <div className="flex justify-between items-start gap-2">
                                <div className="flex-1">
                                    <CardTitle className="text-base leading-tight">{shift.task}</CardTitle>
                                    {showOperative && (
                                        <p className="text-sm font-semibold text-primary mt-1 flex items-center gap-1.5">
                                            <Users className="h-4 w-4" />
                                            {userNameMap.get(shift.userId) || 'Unknown'}
                                        </p>
                                    )}
                                    <p className="text-sm text-muted-foreground mt-1 flex items-start gap-1">
                                        <MapPin className="h-3 w-3 shrink-0 mt-0.5" />
                                        {shift.address}
                                    </p>
                                    {shift.eNumber && <p className="text-xs text-muted-foreground mt-1 font-semibold">No: {shift.eNumber}</p>}
                                </div>
                                <Badge variant={shift.type === 'am' ? 'default' : 'outline'} className="capitalize text-[10px] h-5 px-1.5 whitespace-nowrap">
                                    {shift.type === 'all-day' ? 'All Day' : shift.type.toUpperCase()}
                                </Badge>
                            </div>
                        </CardHeader>
                        <CardContent className="p-4 pt-0 pb-2">
                            {isPrivilegedForPlanner && shift.department === 'Gas' && (
                                <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                                    <FileText className="h-3 w-3" />
                                    Source: {shift.plannerName || 'Manual Entry'}
                                </p>
                            )}
                        </CardContent>
                        <CardFooter className="p-2 border-t bg-muted/30 flex justify-between items-center">
                            <div className="flex-1">
                                {getStatusBadge(shift)}
                            </div>
                            {isOwner && (
                                <div className="flex items-center gap-1">
                                    <Button variant="outline" size="sm" className="h-8 text-xs px-2" onClick={() => handleEditShift(shift)}>
                                        <Edit className="h-3 w-3 mr-1" /> Edit
                                    </Button>
                                    {isPhil && (
                                        <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                                <Button variant="destructive" size="sm" className="h-8 text-xs px-2">
                                                    <Trash2 className="h-3 w-3 mr-1" /> Delete
                                                </Button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent>
                                                <AlertDialogHeader>
                                                    <AlertDialogTitle>Delete Shift?</AlertDialogTitle>
                                                    <AlertDialogDescription>Are you sure you want to permanently delete this shift? This action cannot be undone.</AlertDialogDescription>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter>
                                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                    <AlertDialogAction onClick={() => handleDeleteShift(shift)} className="bg-destructive">Delete</AlertDialogAction>
                                                </AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                    )}
                                </div>
                            )}
                        </CardFooter>
                   </Card>
                ))}
            </div>
        </>
    );
  };

  const availableDepartments = useMemo(() => Array.from(new Set(allUsers.map(u => u.department).filter(Boolean))).sort(), [allUsers]);
  const departmentFilteredProjects = useMemo(() => {
    const relevantDepartments = isOwner ? selectedDepartments : new Set([userProfile.department]);
    if (relevantDepartments.size === 0 && isOwner) return projects;
    return projects.filter(p => p.department && relevantDepartments.has(p.department));
  }, [projects, isOwner, selectedDepartments, userProfile.department]);

  return (
    <>
        <Card>
        <CardHeader>
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div><CardTitle>Team Schedule Overview</CardTitle><CardDescription>A list of all upcoming shifts for the team.</CardDescription></div>
                <div className="flex items-center gap-2 shrink-0 flex-wrap">
                     <Button variant="outline" onClick={() => setViewMode(viewMode === 'user' ? 'site' : 'user')}>
                        {viewMode === 'user' ? <><Building className="mr-2 h-4 w-4" /> Site View</> : <><Users className="mr-2 h-4 w-4" /> User View</>}
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleDownloadDailyReport}><BarChart2 className="mr-2 h-4 w-4" /> Daily Report</Button>
                    {isOwner && <Button onClick={handleAddShift}><PlusCircle className="mr-2 h-4 w-4" /> Add Shift</Button>}
                </div>
            </div>
            {viewMode === 'user' && (
              <div className="pt-4 flex flex-col sm:flex-row gap-4 items-center">
                  <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                      <SelectTrigger className="w-full sm:w-[250px]"><SelectValue placeholder="All Users" /></SelectTrigger>
                      <SelectContent><SelectItem value="all">All Users</SelectItem>{usersForDropdown.map(user => <SelectItem key={user.uid} value={user.uid}>{user.name}</SelectItem>)}</SelectContent>
                  </Select>
                  <Button variant="outline" onClick={() => handleDownloadPdf('this')}><Download className="mr-2 h-4 w-4" /> Weekly Report</Button>
              </div>
            )}
        </CardHeader>
        <CardContent>
          {viewMode === 'site' ? (
            <div className="mt-4 space-y-4">
                <Select onValueChange={setSelectedSiteAddress} value={selectedSiteAddress}>
                    <SelectTrigger className="w-full sm:w-[400px]"><SelectValue placeholder="Select a site address..." /></SelectTrigger>
                    <SelectContent>
                        <ScrollArea className="h-80">
                            {uniqueSiteAddresses.map(address => <SelectItem key={normalizeAddress(address)} value={address}>{address}</SelectItem>)}
                        </ScrollArea>
                    </SelectContent>
                </Select>
                {selectedSiteAddress && (
                    <div className="space-y-4">
                        <div className="flex gap-2"><Button onClick={handleDownloadSiteReport} variant="outline"><Download className="mr-2 h-4 w-4" /> Download PDF</Button></div>
                        {renderShiftList(siteScheduleShifts)}
                    </div>
                )}
            </div>
          ) : (
            <Tabs defaultValue="today" onValueChange={setActiveTab}>
              <div className="flex flex-col space-y-2">
                <TabsList className="grid grid-cols-3"><TabsTrigger value="last-week">Last Week</TabsTrigger><TabsTrigger value="today">Today</TabsTrigger><TabsTrigger value="this-week">This Week</TabsTrigger></TabsList>
                <TabsList className="grid grid-cols-2"><TabsTrigger value="next-week">Next Week</TabsTrigger><TabsTrigger value="archive"><History className="mr-2 h-4 w-4" /> Archive</TabsTrigger></TabsList>
              </div>
              <TabsContent value="today" className="mt-4">{renderShiftList(todayShifts)}</TabsContent>
              <TabsContent value="last-week" className="mt-4">{renderShiftList(lastWeekShifts)}</TabsContent>
              <TabsContent value="this-week" className="mt-4">{renderShiftList(thisWeekShifts)}</TabsContent>
              <TabsContent value="next-week" className="mt-4">{renderShiftList(nextWeekShifts)}</TabsContent>
              <TabsContent value="archive" className="mt-4">
                  <div className="flex flex-col sm:flex-row gap-4 items-center bg-muted/50 p-4 rounded-lg">
                      <Select value={selectedArchiveWeek} onValueChange={setSelectedArchiveWeek}>
                          <SelectTrigger className="w-full sm:w-[250px]"><SelectValue /></SelectTrigger>
                          <SelectContent>{archiveWeekOptions.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                      </Select>
                  </div>
                  {renderShiftList(archiveShifts)}
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
        </Card>
        {isOwner && <ShiftFormDialog open={isFormOpen} onOpenChange={setIsFormOpen} users={allUsers} shift={selectedShift} userProfile={userProfile} projects={departmentFilteredProjects} availableDepartments={availableDepartments} />}
        <Dialog open={isConfirmDeleteAllOpen} onOpenChange={setIsConfirmDeleteAllOpen}>
            <DialogContent><DialogHeader><DialogTitle>Destructive Action</DialogTitle></DialogHeader>
                <div className="space-y-4 pt-4"><Label>Enter Password to Delete All Shifts</Label><Input type="password" value={password} onChange={e => setPassword(e.target.value)} /></div>
                <DialogFooter><Button onClick={handlePasswordConfirmedDeleteAll} variant="destructive">Confirm</Button></DialogFooter>
            </DialogContent>
        </Dialog>
    </>
  );
}
