
'use client';

import { useEffect, useMemo, useState } from 'react';
import { addDays, format, startOfDay, isSameDay, eachDayOfInterval, isBefore, subMonths, startOfMonth, endOfMonth, getDay, addMonths, startOfWeek, endOfWeek, isWithinInterval } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import { collection, onSnapshot, query, addDoc, serverTimestamp, Timestamp, doc, deleteDoc, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Shift, UserProfile, Unavailability } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Calendar as CalendarPicker } from '@/components/ui/calendar';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { Calendar as CalendarIcon, Users, UserCheck, Filter, ChevronDown, Check, Clock, Sun, Moon, MapPin, X, CheckCircle, XCircle, ChevronLeft, ChevronRight, Download, PlusCircle, Trash2, CalendarOff } from 'lucide-react';
import { getCorrectedLocalDate } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useToast } from '@/hooks/use-toast';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { Spinner } from '@/components/shared/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';


type Role = 'user' | 'admin' | 'owner' | 'manager' | 'TLO';
const ALL_ROLES: Role[] = ['user', 'TLO', 'manager', 'admin', 'owner'];


interface DayAvailability {
    date: Date;
    type: 'full' | 'am' | 'pm' | 'busy';
    shiftLocation?: string;
    isUnavailable?: boolean;
}

interface AvailableUser {
  user: UserProfile;
  availability: 'full' | 'partial' | 'unavailable';
  dayStates: DayAvailability[];
}

interface AvailableUserForDay {
    user: UserProfile;
    availability: 'full' | 'am' | 'pm';
    shiftLocation?: string;
}
interface DayData {
    date: Date;
    isCurrentMonth: boolean;
    availableUsers: AvailableUserForDay[];
}

const getInitials = (name?: string) => {
    if (!name) return '??';
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase();
};

const extractLocation = (address: string | undefined): string => {
    if (!address) return '';

    const postcodeRegex = /(L|l)ondon\s+([A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})/i;
    const match = address.match(postcodeRegex);

    if (match && match[0]) {
        return match[0].trim();
    }
    
    // Fallback for just a postcode if "London" isn't there
    const genericPostcodeRegex = /([A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})$/i;
    const genericMatch = address.match(genericPostcodeRegex);
    if (genericMatch && genericMatch[0]) {
        return genericMatch[0].trim();
    }
    
    // Fallback to the last part of the address if no postcode found
    const parts = address.split(',');
    return parts[parts.length - 1].trim();
};

const LS_ROLES_KEY = 'availability_selectedRoles';
const LS_TRADES_KEY = 'availability_selectedTrades';
const LS_VIEW_KEY = 'availability_viewMode';
const LS_FILTER_BY_KEY = 'availability_filterBy';

const unavailabilitySchema = z.object({
    userId: z.string().min(1, "Please select an operative."),
    range: z.object({
        from: z.date({ required_error: 'A start date must be selected.' }),
        to: z.date().optional(),
    }),
    reason: z.string().min(1, "Please select a reason."),
});

function AddUnavailabilityForm({ users, onSuccessfulAdd }: { users: UserProfile[], onSuccessfulAdd: () => void }) {
    const { toast } = useToast();
    const [isLoading, setIsLoading] = useState(false);
    
    const form = useForm<z.infer<typeof unavailabilitySchema>>({
        resolver: zodResolver(unavailabilitySchema),
        defaultValues: {
            userId: '',
            range: {
                from: startOfDay(new Date()),
            },
            reason: ''
        },
    });

    const handleAddUnavailability = async (values: z.infer<typeof unavailabilitySchema>) => {
        setIsLoading(true);
        const { userId, range, reason } = values;
        const user = users.find(u => u.uid === userId);
        if (!user) {
            toast({ variant: 'destructive', title: 'User not found' });
            setIsLoading(false);
            return;
        }

        try {
            await addDoc(collection(db, 'unavailability'), {
                userId,
                userName: user.name,
                startDate: Timestamp.fromDate(range.from),
                endDate: range.to ? Timestamp.fromDate(range.to) : Timestamp.fromDate(range.from),
                reason,
                createdAt: serverTimestamp(),
            });
            toast({ title: 'Success', description: `${user.name}'s unavailability added.` });
            form.reset({
                userId: '',
                range: { from: startOfDay(new Date()) },
                reason: ''
            });
            onSuccessfulAdd();
        } catch (error) {
            console.error('Error adding unavailability: ', error);
            toast({ variant: 'destructive', title: 'Error', description: 'Could not add unavailability record.' });
        } finally {
            setIsLoading(false);
        }
    };
    
    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(handleAddUnavailability)} className="space-y-4 py-4">
                <FormField control={form.control} name="userId" render={({ field }) => (
                    <FormItem>
                        <FormLabel>Operative</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                                <SelectTrigger><SelectValue placeholder="Select an operative..." /></SelectTrigger>
                            </FormControl>
                            <SelectContent><ScrollArea className="h-64">{users.map(u => <SelectItem key={u.uid} value={u.uid}>{u.name}</SelectItem>)}</ScrollArea></SelectContent>
                        </Select>
                        <FormMessage />
                    </FormItem>
                )} />

                <FormField control={form.control} name="range" render={({ field }) => (
                    <FormItem>
                         <FormLabel>
                            Date Range: {field.value?.from ? (field.value.to ? `${format(field.value.from, "PPP")} - ${format(field.value.to, "PPP")}` : format(field.value.from, "PPP")) : <span>Pick a date range</span>}
                        </FormLabel>
                        <div className="flex justify-center rounded-md border">
                            <CalendarPicker
                                mode="range"
                                selected={field.value}
                                onSelect={(range) => {
                                    if (range?.from && range.to && isBefore(range.to, range.from)) {
                                        field.onChange({ from: range.to, to: range.from });
                                    } else {
                                        field.onChange(range);
                                    }
                                }}
                                initialFocus
                            />
                        </div>
                        <FormMessage />
                    </FormItem>
                )} />

                <FormField control={form.control} name="reason" render={({ field }) => (
                    <FormItem>
                        <FormLabel>Reason</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                                <SelectTrigger><SelectValue placeholder="Select a reason..." /></SelectTrigger>
                            </FormControl>
                            <SelectContent>
                                <SelectItem value="Holiday">Holiday</SelectItem>
                                <SelectItem value="Sickness">Sickness</SelectItem>
                                <SelectItem value="Other">Other</SelectItem>
                            </SelectContent>
                        </Select>
                        <FormMessage />
                    </FormItem>
                )} />
                <DialogFooter>
                     <Button type="submit" disabled={isLoading} className="w-full">{isLoading ? <Spinner /> : 'Add Record'}</Button>
                </DialogFooter>
            </form>
        </Form>
    );
}

function UnavailabilityManagerDialog({
    users,
    unavailability,
    handleDeleteUnavailability,
    open,
    onOpenChange,
}: {
    users: UserProfile[];
    unavailability: Unavailability[];
    handleDeleteUnavailability: (id: string) => void;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const [activeTab, setActiveTab] = useState('add');
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl">
                <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="add">Add Unavailability</TabsTrigger>
                        <TabsTrigger value="view">Upcoming</TabsTrigger>
                    </TabsList>
                    <TabsContent value="add" className="p-1">
                        <DialogHeader>
                            <DialogTitle>Add Unavailability</DialogTitle>
                            <DialogDescription>Record a period of unavailability for an operative.</DialogDescription>
                        </DialogHeader>
                        <AddUnavailabilityForm users={users} onSuccessfulAdd={() => setActiveTab('view')} />
                    </TabsContent>
                    <TabsContent value="view" className="p-1">
                        <DialogHeader>
                            <DialogTitle className="text-lg flex items-center gap-2"><CalendarOff className="h-5 w-5 text-muted-foreground"/>Upcoming Unavailability</DialogTitle>
                            <DialogDescription>List of all upcoming recorded periods of unavailability.</DialogDescription>
                        </DialogHeader>
                         <div className="py-4">
                            {unavailability.length > 0 ? (
                                <ScrollArea className="h-96 border rounded-md">
                                    <Table>
                                    <TableHeader><TableRow><TableHead>Operative</TableHead><TableHead>From</TableHead><TableHead>To</TableHead><TableHead>Reason</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                                    <TableBody>{unavailability.sort((a,b) => a.startDate.toMillis() - b.startDate.toMillis()).map(u => (
                                        <TableRow key={u.id}>
                                            <TableCell>{u.userName}</TableCell>
                                            <TableCell>{format(getCorrectedLocalDate(u.startDate), 'PPP')}</TableCell>
                                            <TableCell>{format(getCorrectedLocalDate(u.endDate), 'PPP')}</TableCell>
                                            <TableCell><Badge variant="outline">{u.reason}</Badge></TableCell>
                                            <TableCell className="text-right">
                                                <AlertDialog>
                                                    <AlertDialogTrigger asChild><Button variant="ghost" size="icon"><Trash2 className="h-4 w-4 text-destructive/70" /></Button></AlertDialogTrigger>
                                                    <AlertDialogContent>
                                                        <AlertDialogHeader><AlertDialogTitle>Delete Record?</AlertDialogTitle><AlertDialogDescription>Are you sure you want to delete this unavailability record for {u.userName}?</AlertDialogDescription></AlertDialogHeader>
                                                        <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => handleDeleteUnavailability(u.id)} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">Delete</AlertDialogAction></AlertDialogFooter>
                                                    </AlertDialogContent>
                                                </AlertDialog>
                                            </TableCell>
                                        </TableRow>
                                    ))}</TableBody>
                                </Table></ScrollArea>
                            ) : (<p className="text-sm text-muted-foreground text-center p-4 border rounded-md">No upcoming unavailability records found.</p>)}
                         </div>
                    </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    );
}

export default function AvailabilityPage() {
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
      from: startOfDay(new Date()),
      to: startOfDay(new Date()),
  });
  const [currentMonth, setCurrentMonth] = useState(startOfMonth(new Date()));
  const [allShifts, setAllShifts] = useState<Shift[]>([]);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [unavailability, setUnavailability] = useState<Unavailability[]>([]);
  const [loading, setLoading] = useState(true);

  const [filterBy, setFilterBy] = useState<'role' | 'trade'>('role');
  const [selectedRoles, setSelectedRoles] = useState<Set<Role>>(new Set(ALL_ROLES));
  const [availableTrades, setAvailableTrades] = useState<string[]>([]);
  const [selectedTrades, setSelectedTrades] = useState<Set<string>>(new Set());
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'detailed' | 'simple'>('detailed');
  
  const [isDayDetailOpen, setIsDayDetailOpen] = useState(false);
  const [selectedDayData, setSelectedDayData] = useState<DayData | null>(null);
  const [isUnavailabilityManagerOpen, setIsUnavailabilityManagerOpen] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    setLoading(true);
    let shiftsLoaded = false, usersLoaded = false, unavailabilityLoaded = false;
    
    const checkAllDataLoaded = () => {
        if (shiftsLoaded && usersLoaded && unavailabilityLoaded) {
            setLoading(false);
        }
    };

    // Load saved preferences from localStorage on initial mount
    try {
        const savedFilterBy = localStorage.getItem(LS_FILTER_BY_KEY);
        if (savedFilterBy) setFilterBy(savedFilterBy as 'role' | 'trade');

        const savedRoles = localStorage.getItem(LS_ROLES_KEY);
        if (savedRoles) setSelectedRoles(new Set(JSON.parse(savedRoles)));
        else setSelectedRoles(new Set(ALL_ROLES));

        const savedTrades = localStorage.getItem(LS_TRADES_KEY);
        const tradesToSet = savedTrades ? new Set(JSON.parse(savedTrades)) : null;

        const savedViewMode = localStorage.getItem(LS_VIEW_KEY);
        if (savedViewMode) setViewMode(savedViewMode as 'detailed' | 'simple');
        
        const shiftsQuery = query(collection(db, 'shifts'));
        const unsubShifts = onSnapshot(shiftsQuery, (snapshot) => {
            setAllShifts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Shift)));
            shiftsLoaded = true;
            checkAllDataLoaded();
        }, (err) => { console.error("Error fetching shifts:", err); shiftsLoaded = true; checkAllDataLoaded(); });

        const usersQuery = query(collection(db, 'users'));
        const unsubUsers = onSnapshot(usersQuery, (snapshot) => {
            const fetchedUsers = snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile));
            setAllUsers(fetchedUsers.sort((a,b) => a.name.localeCompare(b.name)));

            const allAvailableTrades = [...new Set(fetchedUsers.flatMap(u => u.trade).filter(Boolean))] as string[];
            setAvailableTrades(allAvailableTrades.sort());
            
            if (tradesToSet) {
                const validStoredTrades = Array.from(tradesToSet).filter(t => allAvailableTrades.includes(t));
                setSelectedTrades(new Set(validStoredTrades));
            } else {
                setSelectedTrades(new Set(allAvailableTrades));
            }
            
            usersLoaded = true;
            checkAllDataLoaded();
        }, (err) => { console.error("Error fetching users:", err); usersLoaded = true; checkAllDataLoaded(); });

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const unavailabilityQuery = query(collection(db, 'unavailability'), where('endDate', '>=', Timestamp.fromDate(today)));
        const unsubUnavailability = onSnapshot(unavailabilityQuery, (snapshot) => {
            setUnavailability(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Unavailability)));
            unavailabilityLoaded = true;
            checkAllDataLoaded();
        }, (err) => { console.error("Error fetching unavailability:", err); unavailabilityLoaded = true; checkAllDataLoaded(); });

        return () => { unsubShifts(); unsubUsers(); unsubUnavailability(); };

    } catch (e) {
        console.error("Failed to load preferences or data", e);
        setLoading(false);
    }
  }, []);
  
  const handleDeleteUnavailability = async (id: string) => {
    try {
        await deleteDoc(doc(db, 'unavailability', id));
        toast({ title: 'Success', description: 'Unavailability record removed.' });
    } catch (error) {
        toast({ variant: 'destructive', title: 'Error', description: 'Could not remove record.' });
    }
  };

  const handleFilterByChange = (value: 'role' | 'trade') => {
      setFilterBy(value);
      try { localStorage.setItem(LS_FILTER_BY_KEY, value); } 
      catch (e) { console.error("Failed to save filter preference", e); }
  }

  const handleRoleToggle = (role: Role) => {
      setSelectedRoles(prev => {
          const newRoles = new Set(prev);
          if (newRoles.has(role)) newRoles.delete(role);
          else newRoles.add(role);
          try { localStorage.setItem(LS_ROLES_KEY, JSON.stringify(Array.from(newRoles))); } 
          catch (e) { console.error("Failed to save roles to localStorage", e); }
          return newRoles;
      });
  };
  
  const handleTradeToggle = (trade: string) => {
      setSelectedTrades(prev => {
          const newTrades = new Set(prev);
          if (newTrades.has(trade)) newTrades.delete(trade);
          else newTrades.add(trade);
           try { localStorage.setItem(LS_TRADES_KEY, JSON.stringify(Array.from(newTrades))); }
           catch (e) { console.error("Failed to save trades to localStorage", e); }
          return newTrades;
      })
  }

  const handleUserToggle = (userId: string) => {
      setSelectedUserIds(prev => {
          const newUserIds = new Set(prev);
          if (newUserIds.has(userId)) newUserIds.delete(userId);
          else newUserIds.add(userId);
          return newUserIds;
      });
  };

  const handleViewModeChange = (checked: boolean) => {
      const newMode = checked ? 'simple' : 'detailed';
      setViewMode(newMode);
      try { localStorage.setItem(LS_VIEW_KEY, newMode); }
      catch (e) { console.error("Failed to save view mode to localStorage", e); }
  }
  
  const usersMatchingFilters = useMemo(() => {
    return allUsers.filter(u => {
        if (filterBy === 'role') return selectedRoles.size === 0 || selectedRoles.has(u.role as Role);
        if (filterBy === 'trade') return selectedTrades.size === 0 || (u.trade && selectedTrades.has(u.trade));
        return true;
    });
  }, [allUsers, filterBy, selectedRoles, selectedTrades]);


  useEffect(() => {
    const userIdsMatchingFilters = new Set(usersMatchingFilters.map(u => u.uid));
    setSelectedUserIds(userIdsMatchingFilters);
  }, [usersMatchingFilters]);

  const availableUsers: AvailableUser[] = useMemo(() => {
    if (!dateRange?.from || allUsers.length === 0) return [];
  
    const start = startOfDay(dateRange.from);
    const end = dateRange.to ? startOfDay(dateRange.to) : start;
    const intervalDays = eachDayOfInterval({ start, end });
  
    const usersToConsider = allUsers.filter(user => selectedUserIds.has(user.uid));
  
    return usersToConsider
      .map((user): AvailableUser | null => {
        const userShiftsInRange = allShifts.filter(shift =>
            shift.userId === user.uid && 
            isBefore(startOfDay(getCorrectedLocalDate(shift.date)), addDays(end, 1)) &&
            isBefore(start, addDays(startOfDay(getCorrectedLocalDate(shift.date)), 1))
        );

        const userUnavailabilityInRange = unavailability.filter(u => u.userId === user.uid);

        const dayStates = intervalDays.map((day): DayAvailability => {
            const isUnavailable = userUnavailabilityInRange.some(u => isWithinInterval(day, { start: getCorrectedLocalDate(u.startDate), end: getCorrectedLocalDate(u.endDate)}));
            if (isUnavailable) {
                return { date: day, type: 'busy', isUnavailable: true };
            }

            const shiftsOnDay = userShiftsInRange.filter(shift => isSameDay(getCorrectedLocalDate(shift.date), day));
            
            if (shiftsOnDay.length === 0) return { date: day, type: 'full' };
            if (shiftsOnDay.length === 1) {
                const shift = shiftsOnDay[0];
                if (shift.type === 'am') return { date: day, type: 'pm', shiftLocation: shift.address };
                if (shift.type === 'pm') return { date: day, type: 'am', shiftLocation: shift.address };
            }
            return { date: day, type: 'busy' };
        });
  
        const isFullyUnavailable = dayStates.every(d => d.isUnavailable);
        if (isFullyUnavailable) {
            return { user, availability: 'unavailable', dayStates };
        }
        
        const isFullyAvailable = dayStates.every(d => d.type === 'full');
        if (isFullyAvailable) {
            return { user, availability: 'full', dayStates: [] };
        }
  
        const isPartiallyAvailable = dayStates.some(d => d.type !== 'busy');
        if (isPartiallyAvailable) {
            return { user, availability: 'partial', dayStates };
        }

        return null;
      })
      .filter((u): u is AvailableUser => u !== null);
      
  }, [dateRange, allShifts, allUsers, selectedUserIds, unavailability]);

  const monthGridData: DayData[] = useMemo(() => {
    if (viewMode !== 'simple') return [];

    const start = startOfMonth(currentMonth);
    const end = endOfMonth(currentMonth);
    const monthDays = eachDayOfInterval({ start, end });
    
    const startDayOfWeek = getDay(start);
    const startOffset = startDayOfWeek === 0 ? 6 : startDayOfWeek -1;
    const paddingDaysStart = Array.from({length: startOffset}, (_, i) => addDays(start, -(startOffset - i)));
    const daysInGrid = paddingDaysStart.concat(monthDays);
    const endOffset = 7 - (daysInGrid.length % 7);
    const paddingDaysEnd = Array.from({length: endOffset === 7 ? 0 : endOffset}, (_, i) => addDays(end, i + 1));
    const allGridDays = daysInGrid.concat(paddingDaysEnd);

    const usersToConsider = allUsers.filter(user => selectedUserIds.has(user.uid));

    return allGridDays.map(day => {
        const availableUsers: DayData['availableUsers'] = [];
        for (const user of usersToConsider) {
            const isUnavailable = unavailability.some(u => u.userId === user.uid && isWithinInterval(day, { start: getCorrectedLocalDate(u.startDate), end: getCorrectedLocalDate(u.endDate)}));
            if (isUnavailable) continue;

            const shiftsOnDay = allShifts.filter(shift => shift.userId === user.uid && isSameDay(getCorrectedLocalDate(shift.date), day));
            if (shiftsOnDay.length === 0) availableUsers.push({ user, availability: 'full' });
            else if (shiftsOnDay.length === 1) {
                const shift = shiftsOnDay[0];
                if (shift.type === 'am') availableUsers.push({ user, availability: 'pm', shiftLocation: shift.address });
                if (shift.type === 'pm') availableUsers.push({ user, availability: 'am', shiftLocation: shift.address });
            }
        }
        return { date: day, isCurrentMonth: day.getMonth() === currentMonth.getMonth(), availableUsers }
    });

  }, [currentMonth, allShifts, allUsers, selectedUserIds, viewMode, unavailability]);
  
  const handleOpenDayDetail = (dayData: DayData) => {
    setSelectedDayData(dayData);
    setIsDayDetailOpen(true);
  }

  const selectedPeriodText = () => {
    if (!dateRange?.from) return 'No date selected';
    const start = format(dateRange.from, 'PPP');
    if (!dateRange.to || isSameDay(dateRange.from, dateRange.to)) return `for ${start}`;
    const end = format(dateRange.to, 'PPP');
    return `from ${start} to ${end}`;
  }

  const handleDownloadPdf = async (reportType: 'day' | 'week' | 'month' | 'next-month') => {
    const { default: jsPDF } = await import('jspdf');
    const { default: autoTable } = await import('jspdf-autotable');

    if (!dateRange?.from) return;

    let baseDate = dateRange.from;
    let interval;
    let reportTitle = '';

    switch (reportType) {
      case 'day':
        interval = { start: baseDate, end: baseDate };
        reportTitle = `Daily Availability Report for ${format(baseDate, 'PPP')}`;
        break;
      case 'week':
        interval = { start: startOfWeek(baseDate, { weekStartsOn: 1 }), end: endOfWeek(baseDate, { weekStartsOn: 1 }) };
        reportTitle = `Weekly Availability Report (w/c ${format(interval.start, 'dd MMM yyyy')})`;
        break;
      case 'month':
        interval = { start: startOfMonth(baseDate), end: endOfMonth(baseDate) };
        reportTitle = `Monthly Availability Report for ${format(baseDate, 'MMMM yyyy')}`;
        break;
      case 'next-month':
        const nextMonthDate = addMonths(baseDate, 1);
        interval = { start: startOfMonth(nextMonthDate), end: endOfMonth(nextMonthDate) };
        reportTitle = `Monthly Availability Report for ${format(nextMonthDate, 'MMMM yyyy')}`;
        break;
    }
    
    const intervalDays = eachDayOfInterval(interval);
    
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text(reportTitle, 14, 22);
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(`Generated on: ${format(new Date(), 'PPP p')}`, 14, 28);
    
    let finalY = 35;
    
    const usersToConsider = allUsers.filter(u => selectedUserIds.has(u.uid));

    const head = [['Operative', 'Date', 'Availability', 'Notes']];
    const body: string[][] = [];

    usersToConsider.forEach(user => {
      const userShiftsInRange = allShifts.filter(shift => shift.userId === user.uid && isWithinInterval(getCorrectedLocalDate(shift.date), interval));
      const userUnavailabilityInRange = unavailability.filter(u => u.userId === user.uid && isWithinInterval(getCorrectedLocalDate(u.startDate), interval));

      let addedUserRow = false;

      intervalDays.forEach(day => {
        const shiftsOnDay = userShiftsInRange.filter(shift => isSameDay(getCorrectedLocalDate(shift.date), day));
        const unavailabilityOnDay = userUnavailabilityInRange.find(u => isWithinInterval(day, { start: getCorrectedLocalDate(u.startDate), end: getCorrectedLocalDate(u.endDate) }));

        let availability = '';
        let notes = '';

        if (unavailabilityOnDay) {
            availability = 'Unavailable';
            notes = `Reason: ${unavailabilityOnDay.reason}`;
        } else if (shiftsOnDay.length === 0) {
          availability = 'Full Day';
        } else if (shiftsOnDay.length === 1) {
          const shift = shiftsOnDay[0];
          if (shift.type === 'am') {
            availability = 'PM Available';
            notes = `AM shift at ${extractLocation(shift.address)}`;
          } else if (shift.type === 'pm') {
            availability = 'AM Available';
            notes = `PM shift at ${extractLocation(shift.address)}`;
          }
        }
        
        if (availability) {
          body.push([ !addedUserRow ? user.name : '', format(day, 'EEE, dd MMM'), availability, notes ]);
          addedUserRow = true;
        }
      });
    });
    
    autoTable(doc, {
        head, body, startY: finalY, headStyles: { fillColor: [6, 95, 212] },
        didParseCell: function (data) {
            if (data.row.index > 0 && data.section === 'body') {
                if (body[data.row.index][0] === '' && body[data.row.index-1][0] !== '') {
                   data.cell.styles.borderTopWidth = 1;
                   data.cell.styles.borderTopColor = [220, 220, 220];
                }
            }
        }
    });

    doc.save(`availability_report_${reportType}_${format(new Date(), 'yyyy-MM-dd')}.pdf`);
  };

  const renderSimpleView = () => {
    const getBorderColor = (availability: 'full' | 'am' | 'pm') => {
        switch (availability) {
            case 'full': return 'border-green-500';
            case 'am': return 'border-sky-500';
            case 'pm': return 'border-orange-500';
            default: return 'border-gray-400';
        }
    };
    
    return (
    <div className="md:col-span-3 space-y-4">
        <div className="flex justify-between items-center bg-muted/50 p-2 rounded-lg">
            <Button variant="outline" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
                <ChevronLeft className="h-4 w-4" /> Previous
            </Button>
            <h2 className="text-xl font-semibold tracking-tight">{format(currentMonth, 'MMMM yyyy')}</h2>
             <Button variant="outline" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
                Next <ChevronRight className="h-4 w-4" />
            </Button>
        </div>
        <div className="grid grid-cols-7 border-t border-l">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
                <div key={day} className="p-2 border-b border-r text-center font-semibold text-muted-foreground bg-muted/30">{day}</div>
            ))}
            {monthGridData.map((dayData, index) => (
                <div key={index} className={`relative min-h-[120px] border-b border-r p-2 cursor-pointer transition-colors hover:bg-muted/50 ${dayData.isCurrentMonth ? 'bg-background' : 'bg-muted/20'}`} onClick={() => dayData.isCurrentMonth && handleOpenDayDetail(dayData)}>
                    <span className={`text-sm font-medium ${dayData.isCurrentMonth ? 'text-foreground' : 'text-muted-foreground'}`}>
                        {format(dayData.date, 'd')}
                    </span>
                    <div className="mt-2 flex flex-wrap gap-1">
                        <TooltipProvider>
                            {dayData.availableUsers.slice(0, 10).map(({ user, availability, shiftLocation }) => (
                                <Tooltip key={user.uid}>
                                    <TooltipTrigger>
                                         <Avatar className={`h-6 w-6 border-2 ${getBorderColor(availability)}`}>
                                            <AvatarFallback className="text-[10px]">{getInitials(user.name)}</AvatarFallback>
                                        </Avatar>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        <p>
                                            {user.name} - {availability === 'full' ? 'Full Day' : `${availability.toUpperCase()} Available`}
                                            {availability !== 'full' && shiftLocation && <span className="text-muted-foreground text-xs"> (Busy at {extractLocation(shiftLocation)})</span>}
                                        </p>
                                    </TooltipContent>
                                </Tooltip>
                            ))}
                            {dayData.availableUsers.length > 10 && (
                                <Tooltip>
                                    <TooltipTrigger>
                                        <Avatar className="h-6 w-6">
                                            <AvatarFallback className="text-[10px] bg-muted-foreground text-muted">+{dayData.availableUsers.length - 10}</AvatarFallback>
                                        </Avatar>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        <p>{dayData.availableUsers.length - 10} more available</p>
                                    </TooltipContent>
                                </Tooltip>
                            )}
                        </TooltipProvider>
                    </div>
                </div>
            ))}
        </div>
        <div className="flex justify-center items-center gap-6 text-xs text-muted-foreground pt-4">
            <div className="flex items-center gap-2"><div className="h-3 w-3 rounded-full border-2 border-green-500" /><span>Full Day</span></div>
            <div className="flex items-center gap-2"><div className="h-3 w-3 rounded-full border-2 border-sky-500" /><span>AM Available</span></div>
            <div className="flex items-center gap-2"><div className="h-3 w-3 rounded-full border-2 border-orange-500" /><span>PM Available</span></div>
        </div>
    </div>
  );
  }

  const renderDayDetailDialog = () => {
    if (!selectedDayData) return null;

    const fullDay = selectedDayData.availableUsers.filter(u => u.availability === 'full');
    const amAvailable = selectedDayData.availableUsers.filter(u => u.availability === 'am');
    const pmAvailable = selectedDayData.availableUsers.filter(u => u.availability === 'pm');

    const renderUserList = (users: AvailableUserForDay[], title: string, Icon: React.ElementType, color: string) => (
        users.length > 0 && (
            <div>
                <h3 className={`font-semibold mb-2 flex items-center gap-2 ${color}`}><Icon className="h-4 w-4" /> {title} ({users.length})</h3>
                <div className="space-y-2">
                    {users.map(({user, shiftLocation}) => (
                        <div key={user.uid} className="flex items-center justify-between p-2 bg-muted/50 rounded-md text-sm">
                            <div className="flex flex-col">
                                <span>{user.name}</span>
                                <Badge variant="outline" className="text-xs w-fit mt-1 capitalize">{user.trade || user.role}</Badge>
                            </div>
                            {shiftLocation && <span className="text-xs text-muted-foreground truncate max-w-[150px]">Busy at {extractLocation(shiftLocation)}</span>}
                        </div>
                    ))}
                </div>
            </div>
        )
    )

    return (
        <Dialog open={isDayDetailOpen} onOpenChange={setIsDayDetailOpen}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Available Operatives</DialogTitle>
                    <DialogDescription>{format(selectedDayData.date, 'PPPP')}</DialogDescription>
                </DialogHeader>
                <ScrollArea className="max-h-[60vh] -mx-4 px-4">
                    <div className="space-y-6 py-4">
                        {renderUserList(fullDay, "Fully Available", CheckCircle, 'text-green-600')}
                        {renderUserList(amAvailable, "AM Available", Sun, 'text-sky-600')}
                        {renderUserList(pmAvailable, "PM Available", Moon, 'text-orange-600')}
                    </div>
                </ScrollArea>
            </DialogContent>
        </Dialog>
    )
  }
  
  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
            <div>
                <CardTitle>Operative Availability</CardTitle>
                <CardDescription>Select a date or a date range to view which operatives are available.</CardDescription>
            </div>
            <div className="flex items-center space-x-2">
                <Label htmlFor="view-mode-toggle">Simple View</Label>
                <Switch id="view-mode-toggle" checked={viewMode === 'simple'} onCheckedChange={handleViewModeChange} />
            </div>
        </div>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {viewMode === 'simple' && renderSimpleView()}

        {viewMode === 'detailed' && (
            <>
                <div className="col-span-3 space-y-6">
                    <Card className="bg-muted/30">
                        <CardHeader className="py-4">
                            <div className="flex justify-between items-center">
                                <CardTitle className="text-base flex items-center gap-2"><Filter className="h-4 w-4" /> Filters</CardTitle>
                                <div className="flex gap-2">
                                     <Button variant="outline" size="sm" onClick={() => setIsUnavailabilityManagerOpen(true)}>
                                        <CalendarOff className="mr-2 h-4 w-4" />
                                        Manage Unavailability
                                    </Button>
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button variant="outline" size="sm" disabled={!dateRange?.from}><Download className="h-4 w-4 mr-2" /> Download Report</Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent>
                                            <DropdownMenuItem onClick={() => handleDownloadPdf('day')}>Daily Report</DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => handleDownloadPdf('week')}>Weekly Report</DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => handleDownloadPdf('month')}>This Month Report</DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => handleDownloadPdf('next-month')}>Next Month Report</DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-6 items-start pt-6">
                           <div className="space-y-4">
                                <div className="space-y-2">
                                    <h4 className="font-medium text-sm">Filter By</h4>
                                    <RadioGroup value={filterBy} onValueChange={handleFilterByChange as (value: string) => void} className="flex space-x-4">
                                        <div className="flex items-center space-x-2"><RadioGroupItem value="role" id="filter-role" /><Label htmlFor="filter-role">Role</Label></div>
                                        <div className="flex items-center space-x-2"><RadioGroupItem value="trade" id="filter-trade" /><Label htmlFor="filter-trade">Trade</Label></div>
                                    </RadioGroup>
                                </div>
                                {filterBy === 'role' && (
                                    <div className="space-y-2">
                                        <h4 className="font-medium text-sm">Roles</h4>
                                        <div className="flex flex-wrap gap-x-4 gap-y-2">{ALL_ROLES.map(role => (<div key={role} className="flex items-center space-x-2"><Checkbox id={`role-${role}`} checked={selectedRoles.has(role)} onCheckedChange={() => handleRoleToggle(role)} /><Label htmlFor={`role-${role}`} className="capitalize">{role}</Label></div>))}</div>
                                    </div>
                                )}
                                {filterBy === 'trade' && (
                                    <div className="space-y-2">
                                        <h4 className="font-medium text-sm">Trades</h4>
                                        {availableTrades.length > 0 ? (
                                            <div className="flex flex-wrap gap-x-4 gap-y-2">{availableTrades.map(trade => (<div key={trade} className="flex items-center space-x-2"><Checkbox id={`trade-${trade}`} checked={selectedTrades.has(trade)} onCheckedChange={() => handleTradeToggle(trade)} /><Label htmlFor={`trade-${trade}`} className="capitalize font-normal">{trade}</Label></div>))}</div>
                                        ) : (<p className="text-xs text-muted-foreground">No trades assigned to users.</p>)}
                                    </div>
                                )}
                           </div>
                            <div className="space-y-2">
                                <h4 className="font-medium text-sm">Users</h4>
                                <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="outline" className="w-full sm:w-[250px] justify-between">
                                    <span>{selectedUserIds.size} of {usersMatchingFilters.length} users selected</span>
                                    <ChevronDown className="h-4 w-4" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">
                                    <ScrollArea className="h-72">{usersMatchingFilters.map(user => (<DropdownMenuCheckboxItem key={user.uid} checked={selectedUserIds.has(user.uid)} onCheckedChange={() => handleUserToggle(user.uid)}><span className="truncate">{user.name}</span></DropdownMenuCheckboxItem>))}</ScrollArea>
                                </DropdownMenuContent>
                                </DropdownMenu>
                            </div>
                        </CardContent>
                    </Card>

                    {loading ? (
                        <div className="space-y-4">
                            <Skeleton className="h-8 w-1/2" />
                            <Skeleton className="h-32 w-full" />
                        </div>
                    ) : (
                        <div className="space-y-6">
                            <div className="flex justify-center">
                                <CalendarPicker mode="range" selected={dateRange} onSelect={setDateRange} className="rounded-md border" defaultMonth={dateRange?.from} numberOfMonths={1} />
                            </div>
                            <div>
                                <h3 className="text-lg font-semibold flex items-center gap-2 mb-3"><UserCheck className="text-green-600 h-5 w-5"/>Available Operatives ({availableUsers.filter(u => u.availability !== 'unavailable').length})<span className="text-sm font-normal text-muted-foreground ml-2">{selectedPeriodText()}</span></h3>
                                {availableUsers.length > 0 ? (
                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                    {availableUsers.map(({ user, availability, dayStates }) => (
                                        <div key={user.uid} className={cn("flex items-start gap-3 p-3 border rounded-md", availability === 'unavailable' ? 'bg-destructive/10' : 'bg-muted/50')}>
                                            <Avatar className="h-8 w-8"><AvatarFallback>{getInitials(user.name)}</AvatarFallback></Avatar>
                                            <div className="flex-1">
                                            <p className="text-sm font-medium">{user.name}</p>
                                            {availability === 'full' && (<Badge variant="outline" className="mt-1 border-green-500/50 bg-green-500/10 text-green-700">Fully Available</Badge>)}
                                            {availability === 'unavailable' && (<Badge variant="destructive" className="mt-1">Unavailable</Badge>)}
                                            {availability === 'partial' && (
                                                <div className="text-xs mt-1 space-y-2">
                                                    <Badge variant="outline" className="border-blue-500/50 bg-blue-500/10 text-blue-700">Partially Available</Badge>
                                                    <div className="space-y-1 pt-1">{dayStates.filter(d => d.type !== 'busy').map(d => (<div key={d.date.toISOString()} className="flex items-center gap-2"><CheckCircle className="h-3.5 w-3.5 text-green-600" /><span className="font-medium">{format(d.date, 'EEE, dd MMM')}:</span>{d.type === 'full' && <span>All Day</span>}{d.type === 'am' && <span>AM Free</span>}{d.type === 'pm' && <span>PM Free</span>}{d.shiftLocation && <span className="text-muted-foreground text-[10px] truncate">(Busy at {extractLocation(d.shiftLocation)})</span>}</div>))}</div>
                                                    <div className="space-y-1 pt-1">{dayStates.filter(d => d.type === 'busy').map(d => (<div key={d.date.toISOString()} className="flex items-center gap-2 text-muted-foreground"><XCircle className="h-3.5 w-3.5 text-destructive" /><span className="font-medium">{format(d.date, 'EEE, dd MMM')}:</span><span>Unavailable</span></div>))}</div>
                                                </div>
                                            )}
                                            </div>
                                        </div>
                                    ))}
                                    </div>
                                ) : (
                                    <Alert className="border-dashed"><Users className="h-4 w-4" /><AlertTitle>No Operatives Available</AlertTitle><AlertDescription>No users match the current date and filter criteria. Try adjusting your filters.</AlertDescription></Alert>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </>
        )}
      </CardContent>
      {renderDayDetailDialog()}
       <UnavailabilityManagerDialog 
        users={allUsers}
        unavailability={unavailability}
        handleDeleteUnavailability={handleDeleteUnavailability}
        open={isUnavailabilityManagerOpen}
        onOpenChange={setIsUnavailabilityManagerOpen}
       />
    </Card>
  );
}
