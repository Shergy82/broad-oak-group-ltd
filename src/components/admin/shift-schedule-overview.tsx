

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
  Users,
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
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

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
  const [isDeleting, setIsDeleting] = useState(false);
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
  const [selectedSiteAddress, setSelectedSiteAddress] = useState<string | null>(null);
  const [siteTimeFrame, setSiteTimeFrame] = useState<'1w' | '2w' | 'all'>('all');

  const { selectedDepartments } = useDepartmentFilter();
  const isOwner = userProfile.role === 'owner';

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
        // Fallback for privileged users without a department
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

    let unsubProjects = () => {};
    if (isOwner) {
        const projectsQuery = query(collection(db, 'projects'));
        unsubProjects = onSnapshot(projectsQuery, (snapshot) => {
            setProjects(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)));
        });
    }

    return () => {
      unsubShifts();
      unsubProjects();
    };
  }, [isOwner, userProfile.uid, userProfile.department]);

  const getCorrectedLocalDate = (date: { toDate: () => Date }) => {
    const d = date.toDate();
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  };
  
  const {
    usersForDropdown,
    todayShifts,
    thisWeekShifts,
    lastWeekShifts,
    nextWeekShifts,
    week3Shifts,
    week4Shifts,
    archiveShifts,
  } = useMemo(() => {
    // Determine the pool of users to display based on role and department filters.
    const relevantUsers = allUsers.filter(u => {
        if (isOwner) {
          // Owners see users from the departments they have selected in the filter.
          return u.department && selectedDepartments.has(u.department);
        }
        if (userProfile.department) {
          // Non-owners see users only from their own department.
          return u.department === userProfile.department;
        }
        // Fallback for users with no department (they see only themselves).
        return u.uid === userProfile.uid;
      });

    const usersForDropdownResult = [...relevantUsers].sort((a, b) => a.name.localeCompare(b.name));
    const relevantUserIds = new Set(relevantUsers.map(u => u.uid));

    // Filter all shifts to include only those belonging to the relevant users.
    const departmentFilteredShifts = allShifts.filter(shift => relevantUserIds.has(shift.userId));
    
    // Now, apply the user selection from the dropdown.
    const finalFilteredShifts = selectedUserId === 'all'
      ? departmentFilteredShifts
      : departmentFilteredShifts.filter(s => s.userId === selectedUserId);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
  
    const shiftsToday = finalFilteredShifts.filter(s =>
      isToday(getCorrectedLocalDate(s.date))
    );

    const shiftsThisWeek = finalFilteredShifts.filter(s =>
        isSameWeek(getCorrectedLocalDate(s.date), today, { weekStartsOn: 1 })
    );

    const startOfLastWeek = startOfWeek(subDays(today, 7), {
      weekStartsOn: 1,
    });
    const shiftsLastWeek = finalFilteredShifts.filter(s =>
      isSameWeek(
        getCorrectedLocalDate(s.date),
        startOfLastWeek,
        { weekStartsOn: 1 }
      )
    );

    const shiftsNextWeek = finalFilteredShifts.filter(s =>
      isSameWeek(
        getCorrectedLocalDate(s.date),
        addDays(today, 7),
        { weekStartsOn: 1 }
      )
    );

    const shiftsWeek3 = finalFilteredShifts.filter(s =>
      isSameWeek(
        getCorrectedLocalDate(s.date),
        addDays(today, 14),
        { weekStartsOn: 1 }
      )
    );

    const shiftsWeek4 = finalFilteredShifts.filter(s =>
      isSameWeek(
        getCorrectedLocalDate(s.date),
        addDays(today, 21),
        { weekStartsOn: 1 }
      )
    );
  
    const sixWeeksAgo = startOfWeek(subWeeks(today, 5), { weekStartsOn: 1 });
    const historicalShifts = finalFilteredShifts.filter(s => {
      const shiftDate = getCorrectedLocalDate(s.date);
      return shiftDate >= sixWeeksAgo && shiftDate < startOfWeek(today, { weekStartsOn: 1 }) && ['completed', 'incomplete'].includes(s.status);
    });
      
    const selectedArchiveDate = startOfWeek(subWeeks(today, parseInt(selectedArchiveWeek)), { weekStartsOn: 1 });
    const finalArchiveShifts = historicalShifts.filter(s =>
      isSameWeek(getCorrectedLocalDate(s.date), selectedArchiveDate, { weekStartsOn: 1 })
    );
  
    return {
      usersForDropdown: usersForDropdownResult,
      todayShifts: shiftsToday,
      thisWeekShifts: shiftsThisWeek,
      lastWeekShifts: shiftsThisWeek,
      nextWeekShifts: shiftsNextWeek,
      week3Shifts: shiftsWeek3,
      week4Shifts: shiftsWeek4,
      archiveShifts: finalArchiveShifts
    };
  
  }, [allShifts, allUsers, isOwner, selectedDepartments, selectedUserId, userProfile.department, userProfile.uid, selectedArchiveWeek]);

  const userNameMap = useMemo(() => {
    const map = new Map<string, string>();
    allUsers.forEach(user => map.set(user.uid, user.name));
    return map;
  }, [allUsers]);

  const archiveWeekOptions = useMemo(() => {
    const options = [];
    const today = new Date();
    for (let i = 0; i < 6; i++) {
      const weekStart = startOfWeek(subWeeks(today, i), { weekStartsOn: 1 });
      options.push({
        value: i.toString(),
        label: `w/c ${format(weekStart, 'dd/MM/yy')}`
      });
    }
    return options;
  }, []);
  
  const uniqueSiteAddresses = useMemo(() => {
    const addresses = new Set<string>();
    allShifts.forEach(shift => {
        if(shift.address) addresses.add(shift.address);
    });
    return Array.from(addresses).sort();
  }, [allShifts]);

  const siteScheduleShifts = useMemo(() => {
    if (!selectedSiteAddress) return [];
    
    const siteShifts = allShifts.filter(s => s.address === selectedSiteAddress);
    
    let filteredByDate = siteShifts;

    if (siteTimeFrame !== 'all') {
      const today = startOfToday();
      const weeks = siteTimeFrame === '1w' ? 1 : 2;
      const endDate = addDays(today, weeks * 7);
      filteredByDate = siteShifts.filter(s => {
          const shiftDate = getCorrectedLocalDate(s.date);
          return shiftDate >= today && shiftDate < endDate;
      });
    }
    
    return filteredByDate.sort((a,b) => getCorrectedLocalDate(a.date).getTime() - getCorrectedLocalDate(b.date).getTime());
  }, [selectedSiteAddress, allShifts, siteTimeFrame]);


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
        console.error("Error deleting shift:", error);
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

    const allThisWeekShifts = allShifts.filter(s => isSameWeek(getCorrectedLocalDate(s.date), today, { weekStartsOn: 1 }));
    const allNextWeekShifts = allShifts.filter(s => {
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

        if (finalY > 40) {
            finalY += 8;
        }
        doc.setFontSize(16);
        doc.text(periodTitle, pageContentMargin, finalY);
        finalY += 10;
        
        const shiftsByUser = new Map<string, Shift[]>();
        periodFilteredShifts.forEach(shift => {
            if (!shiftsByUser.has(shift.userId)) {
                shiftsByUser.set(shift.userId, []);
            }
            shiftsByUser.get(shift.userId)!.push(shift);
        });

        const usersToIterate = selectedUser ? [selectedUser] : [...allUsers].sort((a, b) => (a.name || '').localeCompare(b.name || '')).filter(u => shiftsByUser.has(u.uid));
        
        for (const user of usersToIterate) {
            const userShifts = shiftsByUser.get(user.uid) || [];
            if (userShifts.length === 0) continue;

            userShifts.sort((a, b) => getCorrectedLocalDate(a.date).getTime() - getCorrectedLocalDate(b.date).getTime());
            
            const head = [['Date', 'Type', 'Task & Address', 'Status']];
            const body = userShifts.map(shift => {
                const shiftDate = getCorrectedLocalDate(shift.date);
                const statusText = shift.status.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                let taskAndAddress = `${shift.task}\n${shift.address}`;
                const rowData = {
                    date: format(shiftDate, 'EEE, dd MMM'),
                    type: shift.type === 'all-day' ? 'All Day' : shift.type.toUpperCase(),
                    task: taskAndAddress,
                    status: statusText,
                    notes: ((shift.status === 'incomplete' || shift.status === 'rejected') && shift.notes) ? `Note: ${shift.notes}` : null,
                };
                return rowData;
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
                body: body.map(row => [row.date, row.type, row.task, row.status]),
                startY: tableStartY,
                headStyles: { fillColor: [6, 95, 212] },
                didDrawPage: (data: any) => {
                    finalY = data.cursor?.y || 0;
                },
                didParseCell: (data) => {
                    if (data.row.index >= 0 && data.section === 'body' && data.column.dataKey === 2) {
                        const rowData = body[data.row.index];
                        if (rowData?.notes) {
                            (data.cell.text as any) = [rowData.task, rowData.notes];
                        }
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

    if (period === 'this' || period === 'both') {
        generateTablesForPeriod("This Week's Shifts", allThisWeekShifts);
    }
    if (period === 'next' || period === 'both') {
        generateTablesForPeriod("Next Week's Shifts", allNextWeekShifts);
    }

    if (allThisWeekShifts.filter(s => selectedUserId === 'all' || s.userId === selectedUserId).length === 0 && 
        allNextWeekShifts.filter(s => selectedUserId === 'all' || s.userId === selectedUserId).length === 0) {
      doc.text("No shifts scheduled for these periods.", pageContentMargin, finalY);
    }
    
    addPageNumbers();
    doc.save(`team_schedule_${format(generationDate, 'yyyy-MM-dd')}.pdf`);
  };

  const handleDownloadSiteReport = async () => {
    if (!selectedSiteAddress || siteScheduleShifts.length === 0) {
        toast({
            title: 'No Data to Export',
            description: 'No shifts found for the selected site and timeframe.',
        });
        return;
    }

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.width;
    const pageMargin = 15;
    
    // --- Header ---
    doc.setFillColor(241, 245, 249); // slate-100, a light gray for the header bg
    doc.rect(0, 0, pageWidth, 28, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(15, 23, 42); // slate-900
    doc.text('BROAD OAK GROUP', pageMargin, 17);
    
    // --- Title ---
    let currentY = 40;
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42); 
    doc.text('Plan of Works', pageMargin, currentY);
    currentY += 10;

    doc.setFontSize(14);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(51, 65, 85); // slate-700
    const addressLines = doc.splitTextToSize(selectedSiteAddress, pageWidth - (pageMargin * 2));
    doc.text(addressLines, pageMargin, currentY);
    currentY += (addressLines.length * 6) + 10;
    
    doc.setFontSize(9);
    doc.setTextColor(148, 163, 184); // slate-400
    doc.text(`Report generated on: ${format(new Date(), 'PPP')}`, pageMargin, currentY);
    currentY += 10;
    
    const head = [['Date', 'Task', 'Operative']];
    const body = siteScheduleShifts.map(shift => [
      format(getCorrectedLocalDate(shift.date), 'EEE, dd MMM yyyy'),
      shift.task,
      userNameMap.get(shift.userId) || 'Unknown'
    ]);
    
    autoTable(doc, {
      startY: currentY,
      head,
      body,
      theme: 'grid',
      headStyles: { fillColor: [6, 95, 212] },
      columnStyles: {
        0: { cellWidth: 35 },
        1: { cellWidth: 'auto' }, 
        2: { cellWidth: 35 },
      },
      didDrawPage: (data: any) => {
        // Add footer on each page
        const pageCount = (doc.internal as any).getNumberOfPages();
        if (pageCount > 1) {
            doc.setFontSize(10);
            doc.setTextColor(150);
            doc.text(`Page ${data.pageNumber} of ${pageCount}`, data.settings.margin.left, doc.internal.pageSize.height - 10);
        }
      }
    });
    
    doc.save(`site_schedule_${selectedSiteAddress.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`);
  };

  const handleDownloadDailyReport = async () => {
    const { default: jsPDF } = await import('jspdf');
    const { default: autoTable } = await import('jspdf-autotable');

    const today = startOfToday();
    const todayShifts = allShifts.filter(s => isSameDay(getCorrectedLocalDate(s.date), today));

    if (todayShifts.length === 0) {
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
    todayShifts.forEach(shift => {
        if (!shiftsByUser.has(shift.userId)) {
            shiftsByUser.set(shift.userId, []);
        }
        shiftsByUser.get(shift.userId)!.push(shift);
    });

    const usersWithShiftsToday = [...allUsers]
        .filter(u => shiftsByUser.has(u.uid))
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    for (const user of usersWithShiftsToday) {
        const userShifts = shiftsByUser.get(user.uid) || [];
        userShifts.sort((a, b) => {
            const typeOrder = { 'am': 1, 'pm': 2, 'all-day': 3 };
            return typeOrder[a.type] - typeOrder[b.type];
        });

        const head = [['Type', 'Task & Address', 'Status']];
        const body = userShifts.map(shift => {
            const statusText = shift.status.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            return [
                shift.type === 'all-day' ? 'All Day' : shift.type.toUpperCase(),
                `${shift.task}\n${shift.address}`,
                statusText
            ];
        });

        let tableStartY = finalY + 10;
        
        doc.setFontSize(14);
        doc.setFont(doc.getFont().fontName, 'bold');
        doc.text(user.name, 14, tableStartY - 5);
        tableStartY += 2;

        autoTable(doc, {
            head,
            body,
            startY: tableStartY,
            headStyles: { fillColor: [6, 95, 212] },
            didDrawPage: (data: any) => {
                finalY = data.cursor?.y || 0;
            },
        });
        finalY = (doc as any).lastAutoTable.finalY;
    }

    doc.save(`daily_report_${format(today, 'yyyy-MM-dd')}.pdf`);
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
        console.error("Error deleting all shifts:", error);
        toast({
            variant: 'destructive',
            title: 'Deletion Failed',
            description: error.message || 'An unknown error occurred.',
        });
    } finally {
        setIsDeleting(false);
    }
  };

  const handlePasswordConfirmedDeleteAll = async () => {
    if (!user || !user.email) {
      toast({ title: 'Could not verify user.', variant: 'destructive' });
      return;
    }
    if (!password) {
      setReauthError('Password is required.');
      return;
    }
    setIsReauthenticating(true);
    setReauthError(null);
    try {
      const credential = EmailAuthProvider.credential(user.email, password);
      await reauthenticateWithCredential(user, credential);
      await handleDeleteAllShifts();
      setIsConfirmDeleteAllOpen(false);
    } catch (error) {
      setReauthError('Incorrect password. Deletion cancelled.');
    } finally {
      setIsReauthenticating(false);
      setPassword('');
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
                    <TooltipProvider>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-[180px]">Date</TableHead>
                                    { (selectedUserId === 'all' || activeTab === 'archive') && <TableHead className="w-[180px]">Operative</TableHead> }
                                    <TableHead>Task &amp; Address</TableHead>
                                    <TableHead>Manager</TableHead>
                                    <TableHead className="text-right w-[110px]">Type</TableHead>
                                    <TableHead className="text-right w-[160px]">Status</TableHead>
                                    {isOwner && <TableHead className="text-right w-[140px]">Actions</TableHead>}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {shiftsToRender.map(shift => (
                                    <TableRow key={shift.id}>
                                        <TableCell className="font-medium">{format(getCorrectedLocalDate(shift.date), 'eeee, MMM d')}</TableCell>
                                        { (selectedUserId === 'all' || activeTab === 'archive') && <TableCell>{userNameMap.get(shift.userId) || 'Unknown'}</TableCell> }
                                        <TableCell>
                                            <div className="font-medium whitespace-pre-wrap">{shift.task}</div>
                                            <div className="text-xs text-muted-foreground whitespace-pre-wrap">{shift.address}</div>
                                            {shift.eNumber && <div className="text-xs text-muted-foreground">{shift.eNumber}</div>}
                                        </TableCell>
                                        <TableCell className="text-xs text-muted-foreground">
                                            {shift.manager || 'N/A'}
                                            {shift.notes && (shift.status !== 'incomplete' && shift.status !== 'rejected') && (
                                                <Popover>
                                                <PopoverTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="h-7 w-7 ml-1">
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
                    </TooltipProvider>
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
                            { (selectedUserId === 'all' || activeTab === 'archive') && <div><strong>Operative:</strong> {userNameMap.get(shift.userId) || 'Unknown'}</div> }
                            <div><strong>Date:</strong> {format(getCorrectedLocalDate(shift.date), 'eeee, MMM d')}</div>
                            {shift.eNumber && <div><strong>Number:</strong> {shift.eNumber}</div>}
                            {shift.manager && <div><strong>Manager:</strong> {shift.manager}</div>}
                            {shift.notes && (shift.status !== 'incomplete' && shift.status !== 'rejected') && (
                                <div className="pt-1">
                                    <strong>Notes:</strong>
                                    <p className="whitespace-pre-wrap">{shift.notes}</p>
                                </div>
                            )}
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

  const renderWeekSchedule = (shiftsToRender: Shift[]) => {
    if (loading || usersLoading) {
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

    const activeShifts = sortShifts(shiftsToRender.filter(s => ['pending-confirmation', 'confirmed', 'on-site', 'rejected'].includes(s.status)));
    const historicalShifts = sortShifts(shiftsToRender.filter(s => ['completed', 'incomplete'].includes(s.status)))
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

  const renderArchiveView = () => {
    if (loading || usersLoading) {
      return (
        <div className="border rounded-lg overflow-hidden mt-4">
            <Skeleton className="h-48 w-full" />
        </div>
      );
    }

    const sortedShifts = [...archiveShifts].sort((a, b) => {
        const dateA = getCorrectedLocalDate(a.date).getTime();
        const dateB = getCorrectedLocalDate(b.date).getTime();
        if (dateA !== dateB) return dateB - dateA; // Most recent first in archive
        
        const nameA = userNameMap.get(a.userId) || '';
        const nameB = userNameMap.get(b.userId) || '';
        if (nameA !== nameB) return nameA.localeCompare(nameB);

        const typeOrder = { 'am': 1, 'pm': 2, 'all-day': 3 };
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
  }

  const renderSiteView = () => (
    <div className="mt-4 space-y-4">
        <div className="flex flex-col sm:flex-row gap-4 items-start">
            <Select onValueChange={setSelectedSiteAddress} value={selectedSiteAddress || ''}>
                <SelectTrigger className="w-full sm:w-[300px]">
                    <SelectValue placeholder="Select a site address..." />
                </SelectTrigger>
                <SelectContent>
                    {uniqueSiteAddresses.map(address => (
                        <SelectItem key={address} value={address}>{address}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
            {selectedSiteAddress && (
                <div className="flex flex-col sm:flex-row gap-2 w-full">
                    <RadioGroup value={siteTimeFrame} onValueChange={(v) => setSiteTimeFrame(v as any)} className="flex items-center space-x-2 border p-2 rounded-md">
                        <div className="flex items-center space-x-1"><RadioGroupItem value="1w" id="1w"/><Label htmlFor="1w">1 Week</Label></div>
                        <div className="flex items-center space-x-1"><RadioGroupItem value="2w" id="2w"/><Label htmlFor="2w">2 Weeks</Label></div>
                        <div className="flex items-center space-x-1"><RadioGroupItem value="all" id="all"/><Label htmlFor="all">Full Works</Label></div>
                    </RadioGroup>
                    <Button onClick={handleDownloadSiteReport} variant="outline" className="w-full sm:w-auto">
                        <Download className="mr-2 h-4 w-4" /> Download PDF
                    </Button>
                </div>
            )}
        </div>

        {selectedSiteAddress && (
            loading ? <Skeleton className="h-48 w-full" /> :
            siteScheduleShifts.length === 0 ? <p className="text-muted-foreground text-center mt-4">No shifts found for this site and timeframe.</p> :
            <div className="border rounded-lg mt-4">
              <Table>
                  <TableHeader>
                      <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Task</TableHead>
                          <TableHead>Operative</TableHead>
                      </TableRow>
                  </TableHeader>
                  <TableBody>
                      {siteScheduleShifts.map(shift => (
                          <TableRow key={shift.id}>
                              <TableCell>{format(getCorrectedLocalDate(shift.date), 'eeee, MMM d, yyyy')}</TableCell>
                              <TableCell>{shift.task}</TableCell>
                              <TableCell>{userNameMap.get(shift.userId) || 'Unknown'}</TableCell>
                          </TableRow>
                      ))}
                  </TableBody>
              </Table>
            </div>
        )}
    </div>
  );
  
  if (error) {
      return (
          <Alert variant="destructive">
              <Terminal className="h-4 w-4" />
              <AlertTitle>Error Loading Schedule</AlertTitle>
              <AlertDescription style={{ whiteSpace: 'pre-wrap' }}>{error}</AlertDescription>
          </Alert>
      )
  }

  const availableDepartments = useMemo(() => {
    return Array.from(new Set(allUsers.map(u => u.department).filter(Boolean))).sort();
  }, [allUsers]);

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
                     <Button variant="outline" onClick={() => {
                        setViewMode(viewMode === 'user' ? 'site' : 'user');
                        if (viewMode === 'site') {
                            setSelectedSiteAddress(null);
                        }
                     }}>
                        {viewMode === 'user' ? (
                            <><Building className="mr-2 h-4 w-4" /> Site View</>
                        ) : (
                            <><Users className="mr-2 h-4 w-4" /> User View</>
                        )}
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleDownloadDailyReport}>
                        <BarChart2 className="mr-2 h-4 w-4" />
                        Daily Report
                    </Button>
                     <Button variant="outline" size="sm" onClick={() => handleDownloadPdf('this')}>
                        <Calendar className="mr-2 h-4 w-4" />
                        Weekly Report
                    </Button>
                    {isOwner && (
                       <div className="flex items-center gap-2">
                        <Button onClick={handleAddShift}>
                            <PlusCircle className="mr-2 h-4 w-4" />
                            Add Shift
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="icon" className="h-10 w-10">
                              <CircleEllipsis />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem 
                              className="text-destructive focus:bg-destructive/10 focus:text-destructive" 
                              disabled={isDeleting}
                              onSelect={() => setIsConfirmDeleteAllOpen(true)}
                            >
                                <Trash className="mr-2" /> Delete All Active
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                       </div>
                    )}
                </div>
            </div>
            {viewMode === 'user' && (
              <div className="pt-4 flex flex-col sm:flex-row gap-4 items-center">
                  <div className="flex-grow w-full sm:w-auto">
                      <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                          <SelectTrigger className="w-full sm:w-[250px]">
                              <SelectValue placeholder="All Users" />
                          </SelectTrigger>
                          <SelectContent>
                              <SelectItem value="all">All Users</SelectItem>
                              {usersForDropdown.map(user => (
                                  <SelectItem key={user.uid} value={user.uid}>{user.name}</SelectItem>
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
            )}
        </CardHeader>
        <CardContent>
          {viewMode === 'site' ? renderSiteView() : (
            <Tabs defaultValue="today" onValueChange={setActiveTab}>
              <div className="flex flex-col space-y-2">
                <TabsList className="grid grid-cols-3">
                  <TabsTrigger value="last-week">Last Week</TabsTrigger>
                  <TabsTrigger value="today">Today</TabsTrigger>
                  <TabsTrigger value="this-week">This Week</TabsTrigger>
                </TabsList>
                <TabsList className="grid grid-cols-3">
                  <TabsTrigger value="next-week">Next Week</TabsTrigger>
                  <TabsTrigger value="week-3">Week 3</TabsTrigger>
                  <TabsTrigger value="week-4">Week 4</TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="today" className="mt-4">
                {renderWeekSchedule(todayShifts)}
              </TabsContent>
              <TabsContent value="last-week" className="mt-4">
                {renderWeekSchedule(lastWeekShifts)}
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
                      <p className="text-sm font-medium text-muted-foreground">View completed and incomplete shifts from the last 6 weeks.</p>
                      <Select value={selectedArchiveWeek} onValueChange={setSelectedArchiveWeek}>
                          <SelectTrigger className="w-full sm:w-[250px]">
                              <SelectValue placeholder="Select a week" />
                          </SelectTrigger>
                          <SelectContent>
                              {archiveWeekOptions.map(option => (
                                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                              ))}
                          </SelectContent>
                      </Select>
                  </div>
                  {renderArchiveView()}
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
        </Card>
        
        {isOwner && (
            <ShiftFormDialog 
                open={isFormOpen} 
                onOpenChange={setIsFormOpen} 
                users={allUsers} 
                shift={selectedShift} 
                userProfile={userProfile}
                projects={projects}
                availableDepartments={availableDepartments}
            />
        )}

        <Dialog open={isConfirmDeleteAllOpen} onOpenChange={setIsConfirmDeleteAllOpen}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Are you absolutely sure?</DialogTitle>
                    <DialogDescription>
                    This is a highly destructive action. To confirm, please enter your password. This will permanently delete all active (published) shifts.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-2 pt-4">
                    <Label htmlFor="password-confirm-shifts">Password</Label>
                    <Input
                    id="password-confirm-shifts"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    />
                    {reauthError && <p className="text-sm text-destructive">{reauthError}</p>}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => setIsConfirmDeleteAllOpen(false)}>Cancel</Button>
                    <Button
                    variant="destructive"
                    onClick={handlePasswordConfirmedDeleteAll}
                    disabled={isReauthenticating || isDeleting}
                    >
                    {isReauthenticating || isDeleting ? <Spinner /> : 'Confirm & Delete All'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    </>
  );
}


    

    

