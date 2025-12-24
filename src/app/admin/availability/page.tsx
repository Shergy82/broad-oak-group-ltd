

'use client';

import { useEffect, useMemo, useState } from 'react';
import { addDays, format, startOfDay, isSameDay, eachDayOfInterval, isBefore, subDays, startOfMonth, endOfMonth, getDaysInMonth, getDay, addMonths, subMonths, startOfWeek, endOfWeek, isWithinInterval } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Shift, UserProfile } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Calendar as CalendarPicker } from '@/components/ui/calendar';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { Calendar as CalendarIcon, Users, UserCheck, Filter, ChevronDown, Check, Clock, Sun, Moon, MapPin, X, CheckCircle, XCircle, ChevronLeft, ChevronRight, Download } from 'lucide-react';
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

type Role = 'user' | 'admin' | 'owner';

interface DayAvailability {
    date: Date;
    type: 'full' | 'am' | 'pm' | 'busy';
    shiftLocation?: string;
}

interface AvailableUser {
  user: UserProfile;
  availability: 'full' | 'partial';
  dayStates: DayAvailability[];
}

interface DayData {
    date: Date;
    isCurrentMonth: boolean;
    availableUsers: {
        user: UserProfile;
        availability: 'full' | 'am' | 'pm';
        shiftLocation?: string;
    }[];
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

export default function AvailabilityPage() {
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
      from: startOfDay(new Date()),
      to: startOfDay(new Date()),
  });
  const [currentMonth, setCurrentMonth] = useState(startOfMonth(new Date()));
  const [allShifts, setAllShifts] = useState<Shift[]>([]);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedRoles, setSelectedRoles] = useState<Set<Role>>(new Set(['user', 'admin', 'owner']));
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [isUserFilterApplied, setIsUserFilterApplied] = useState(false);
  const [viewMode, setViewMode] = useState<'detailed' | 'simple'>('detailed');


  useEffect(() => {
    setLoading(true);
    let shiftsLoaded = false;
    let usersLoaded = false;

    const checkAllDataLoaded = () => {
        if (shiftsLoaded && usersLoaded) {
            setLoading(false);
        }
    };
    
    const shiftsQuery = query(collection(db, 'shifts'));
    const unsubShifts = onSnapshot(shiftsQuery, (snapshot) => {
        setAllShifts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Shift)));
        shiftsLoaded = true;
        checkAllDataLoaded();
    }, (err) => {
        console.error("Error fetching shifts:", err);
        shiftsLoaded = true;
        checkAllDataLoaded();
    });

    const usersQuery = query(collection(db, 'users'));
    const unsubUsers = onSnapshot(usersQuery, (snapshot) => {
        const fetchedUsers = snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile));
        setAllUsers(fetchedUsers.sort((a,b) => a.name.localeCompare(b.name)));
        setSelectedUserIds(new Set(fetchedUsers.map(u => u.uid)));
        usersLoaded = true;
        checkAllDataLoaded();
    }, (err) => {
        console.error("Error fetching users:", err);
        usersLoaded = true;
        checkAllDataLoaded();
    });

    return () => {
        unsubShifts();
        unsubUsers();
    };
  }, []);

  const handleRoleToggle = (role: Role) => {
      setSelectedRoles(prev => {
          const newRoles = new Set(prev);
          if (newRoles.has(role)) {
              newRoles.delete(role);
          } else {
              newRoles.add(role);
          }
          return newRoles;
      });
  };

  const handleUserToggle = (userId: string) => {
      setSelectedUserIds(prev => {
          const newUserIds = new Set(prev);
          if (newUserIds.has(userId)) {
              newUserIds.delete(userId);
          } else {
              newUserIds.add(userId);
          }
          setIsUserFilterApplied(true);
          return newUserIds;
      });
  };

  useEffect(() => {
    if (!isUserFilterApplied) {
        const userIdsInSelectedRoles = allUsers
            .filter(u => selectedRoles.has(u.role as Role))
            .map(u => u.uid);
        setSelectedUserIds(new Set(userIdsInSelectedRoles));
    }
  }, [selectedRoles, allUsers, isUserFilterApplied]);

  const availableUsers: AvailableUser[] = useMemo(() => {
    if (!dateRange?.from || allUsers.length === 0) {
      return [];
    }
  
    const start = startOfDay(dateRange.from);
    const end = dateRange.to ? startOfDay(dateRange.to) : start;
    const intervalDays = eachDayOfInterval({ start, end });
  
    const usersToConsider = allUsers.filter(
      (user) =>
        selectedRoles.has(user.role as Role) && selectedUserIds.has(user.uid)
    );
  
    return usersToConsider
      .map((user): AvailableUser | null => {
        const userShiftsInRange = allShifts.filter(shift =>
            shift.userId === user.uid && 
            isBefore(startOfDay(getCorrectedLocalDate(shift.date)), addDays(end, 1)) &&
            isBefore(subDays(start, 1), startOfDay(getCorrectedLocalDate(shift.date)))
        );

        const dayStates = intervalDays.map((day): DayAvailability => {
            const shiftsOnDay = userShiftsInRange.filter(shift => isSameDay(getCorrectedLocalDate(shift.date), day));
            
            if (shiftsOnDay.length === 0) {
                return { date: day, type: 'full' };
            }
            if (shiftsOnDay.length === 1) {
                const shift = shiftsOnDay[0];
                if (shift.type === 'am') return { date: day, type: 'pm', shiftLocation: shift.address };
                if (shift.type === 'pm') return { date: day, type: 'am', shiftLocation: shift.address };
            }
            return { date: day, type: 'busy' };
        });
  
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
      
  }, [dateRange, allShifts, allUsers, selectedRoles, selectedUserIds]);

  const monthGridData: DayData[] = useMemo(() => {
    if (viewMode !== 'simple') return [];

    const start = startOfMonth(currentMonth);
    const end = endOfMonth(currentMonth);
    const monthDays = eachDayOfInterval({ start, end });
    
    // Day of the week (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
    const startDayOfWeek = getDay(start);
    const startOffset = startDayOfWeek === 0 ? 6 : startDayOfWeek -1;

    const prevMonth = subMonths(start, 1);
    const daysInPrevMonth = getDaysInMonth(prevMonth);
    const paddingDaysStart = Array.from({length: startOffset}, (_, i) => {
        return addDays(start, -(startOffset - i));
    });

    const daysInGrid = paddingDaysStart.concat(monthDays);
    const endOffset = 7 - (daysInGrid.length % 7);

    const paddingDaysEnd = Array.from({length: endOffset === 7 ? 0 : endOffset}, (_, i) => {
        return addDays(end, i + 1);
    });

    const allGridDays = daysInGrid.concat(paddingDaysEnd);

    const usersToConsider = allUsers.filter(
      (user) => selectedRoles.has(user.role as Role) && selectedUserIds.has(user.uid)
    );

    return allGridDays.map(day => {
        const availableUsers: DayData['availableUsers'] = [];
        for (const user of usersToConsider) {
            const shiftsOnDay = allShifts.filter(shift => shift.userId === user.uid && isSameDay(getCorrectedLocalDate(shift.date), day));
            if (shiftsOnDay.length === 0) {
                availableUsers.push({ user, availability: 'full' });
            } else if (shiftsOnDay.length === 1) {
                const shift = shiftsOnDay[0];
                if (shift.type === 'am') availableUsers.push({ user, availability: 'pm', shiftLocation: shift.address });
                if (shift.type === 'pm') availableUsers.push({ user, availability: 'am', shiftLocation: shift.address });
            }
        }
        return {
            date: day,
            isCurrentMonth: day.getMonth() === currentMonth.getMonth(),
            availableUsers
        }
    });

  }, [currentMonth, allShifts, allUsers, selectedRoles, selectedUserIds, viewMode]);
  

  const selectedPeriodText = () => {
    if (!dateRange?.from) return 'No date selected';
    const start = format(dateRange.from, 'PPP');
    if (!dateRange.to || isSameDay(dateRange.from, dateRange.to)) {
        return `for ${start}`;
    }
    const end = format(dateRange.to, 'PPP');
    return `from ${start} to ${end}`;
  }

  const handleDownloadPdf = async (reportType: 'day' | 'week' | 'month') => {
    const { default: jsPDF } = await import('jspdf');
    const { default: autoTable } = await import('jspdf-autotable');

    if (!dateRange?.from) return;

    const baseDate = dateRange.from;
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
      const userShiftsInRange = allShifts.filter(shift =>
          shift.userId === user.uid && isWithinInterval(getCorrectedLocalDate(shift.date), interval)
      );

      let addedUserRow = false;

      intervalDays.forEach(day => {
        const shiftsOnDay = userShiftsInRange.filter(shift => isSameDay(getCorrectedLocalDate(shift.date), day));
        
        let availability = '';
        let notes = '';

        if (shiftsOnDay.length === 0) {
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
          body.push([
            !addedUserRow ? user.name : '',
            format(day, 'EEE, dd MMM'),
            availability,
            notes
          ]);
          addedUserRow = true;
        }
      });
    });
    
    autoTable(doc, {
        head,
        body,
        startY: finalY,
        headStyles: { fillColor: [6, 95, 212] },
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

  const renderSimpleView = () => (
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
            {monthGridData.map(({ date, isCurrentMonth, availableUsers }, index) => (
                <div key={index} className={`relative min-h-[120px] border-b border-r p-2 ${isCurrentMonth ? 'bg-background' : 'bg-muted/20'}`}>
                    <span className={`text-sm font-medium ${isCurrentMonth ? 'text-foreground' : 'text-muted-foreground'}`}>
                        {format(date, 'd')}
                    </span>
                    <div className="mt-2 flex flex-wrap gap-1">
                        <TooltipProvider>
                            {availableUsers.slice(0, 10).map(({ user, availability, shiftLocation }) => (
                                <Tooltip key={user.uid}>
                                    <TooltipTrigger>
                                         <Avatar className={`h-6 w-6 border-2 ${availability === 'full' ? 'border-green-500' : 'border-blue-500'}`}>
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
                            {availableUsers.length > 10 && (
                                <Tooltip>
                                    <TooltipTrigger>
                                        <Avatar className="h-6 w-6">
                                            <AvatarFallback className="text-[10px] bg-muted-foreground text-muted">+{availableUsers.length - 10}</AvatarFallback>
                                        </Avatar>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        <p>{availableUsers.length - 10} more available</p>
                                    </TooltipContent>
                                </Tooltip>
                            )}
                        </TooltipProvider>
                    </div>
                </div>
            ))}
        </div>
    </div>
  );
  
  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
            <div>
                <CardTitle>Operative Availability</CardTitle>
                <CardDescription>
                  Select a date or a date range to view which operatives are available.
                </CardDescription>
            </div>
            <div className="flex items-center space-x-2">
                <Label htmlFor="view-mode-toggle">Simple View</Label>
                <Switch
                    id="view-mode-toggle"
                    checked={viewMode === 'simple'}
                    onCheckedChange={(checked) => setViewMode(checked ? 'simple' : 'detailed')}
                />
            </div>
        </div>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {viewMode === 'simple' && renderSimpleView()}

        {viewMode === 'detailed' && (
            <>
                <div className="flex justify-center">
                     <CalendarPicker
                        mode="range"
                        selected={dateRange}
                        onSelect={(range) => {
                            if (range?.from && range.to && isBefore(range.to, range.from)) {
                                setDateRange({ from: range.to, to: range.from });
                            } else {
                                setDateRange(range);
                            }
                        }}
                        className="rounded-md border"
                        defaultMonth={dateRange?.from}
                        numberOfMonths={1}
                    />
                </div>
                <div className="md:col-span-2 space-y-6">
                    <Card className="bg-muted/30">
                        <CardHeader className="py-4">
                            <div className="flex justify-between items-center">
                                <CardTitle className="text-base flex items-center gap-2">
                                    <Filter className="h-4 w-4" />
                                    Filters
                                </CardTitle>
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="outline" size="sm" disabled={!dateRange?.from}>
                                            <Download className="h-4 w-4 mr-2" />
                                            Download Report
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent>
                                        <DropdownMenuItem onClick={() => handleDownloadPdf('day')}>Daily Report</DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => handleDownloadPdf('week')}>Weekly Report</DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => handleDownloadPdf('month')}>Monthly Report</DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>
                        </CardHeader>
                        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-6 items-start">
                            <div className="space-y-2">
                                <h4 className="font-medium text-sm">Roles</h4>
                                <div className="flex gap-4">
                                {(['user', 'admin', 'owner'] as Role[]).map(role => (
                                    <div key={role} className="flex items-center space-x-2">
                                    <Checkbox
                                        id={`role-${role}`}
                                        checked={selectedRoles.has(role)}
                                        onCheckedChange={() => handleRoleToggle(role)}
                                    />
                                    <Label htmlFor={`role-${role}`} className="capitalize">{role}</Label>
                                    </div>
                                ))}
                                </div>
                            </div>
                            <div className="space-y-2">
                                <h4 className="font-medium text-sm">Users</h4>
                                <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="outline" className="w-full sm:w-[250px] justify-between">
                                    <span>{selectedUserIds.size} of {allUsers.length} users selected</span>
                                    <ChevronDown className="h-4 w-4" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">
                                    <ScrollArea className="h-72">
                                    {allUsers.map(user => (
                                        <DropdownMenuCheckboxItem
                                        key={user.uid}
                                        checked={selectedUserIds.has(user.uid)}
                                        onCheckedChange={() => handleUserToggle(user.uid)}
                                        >
                                        <span className="truncate">{user.name}</span>
                                        </DropdownMenuCheckboxItem>
                                    ))}
                                    </ScrollArea>
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
                    ) : !dateRange?.from ? (
                        <Alert>
                            <CalendarIcon className="h-4 w-4" />
                            <AlertTitle>Select a Date</AlertTitle>
                            <AlertDescription>
                                Click on the calendar to select a date or drag to select a range.
                            </AlertDescription>
                        </Alert>
                    ) : (
                        <div className="space-y-6">
                            <div>
                                <h3 className="text-lg font-semibold flex items-center gap-2 mb-3">
                                    <UserCheck className="text-green-600 h-5 w-5"/>
                                    Available Operatives ({availableUsers.length})
                                    <span className="text-sm font-normal text-muted-foreground ml-2">{selectedPeriodText()}</span>
                                </h3>
                                {availableUsers.length > 0 ? (
                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                    {availableUsers.map(({ user, availability, dayStates }) => (
                                        <div key={user.uid} className="flex items-start gap-3 p-3 border rounded-md bg-muted/50">
                                            <Avatar className="h-8 w-8">
                                                <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
                                            </Avatar>
                                            <div className="flex-1">
                                            <p className="text-sm font-medium">{user.name}</p>
                                            {availability === 'full' && (
                                                <Badge variant="outline" className="mt-1 border-green-500/50 bg-green-500/10 text-green-700">Fully Available</Badge>
                                            )}
                                            {availability === 'partial' && (
                                                <div className="text-xs mt-1 space-y-2">
                                                    <Badge variant="outline" className="border-blue-500/50 bg-blue-500/10 text-blue-700">Partially Available</Badge>
                                                    
                                                    <div className="space-y-1 pt-1">
                                                        {dayStates.filter(d => d.type !== 'busy').map(d => (
                                                            <div key={d.date.toISOString()} className="flex items-center gap-2">
                                                                <CheckCircle className="h-3.5 w-3.5 text-green-600" />
                                                                <span className="font-medium">{format(d.date, 'EEE, dd MMM')}:</span>
                                                                {d.type === 'full' && <span>All Day</span>}
                                                                {d.type === 'am' && <span>AM Free</span>}
                                                                {d.type === 'pm' && <span>PM Free</span>}
                                                                {d.shiftLocation && <span className="text-muted-foreground text-[10px] truncate">(Busy at {extractLocation(d.shiftLocation)})</span>}
                                                            </div>
                                                        ))}
                                                    </div>
                                                    
                                                    <div className="space-y-1 pt-1">
                                                        {dayStates.filter(d => d.type === 'busy').map(d => (
                                                            <div key={d.date.toISOString()} className="flex items-center gap-2 text-muted-foreground">
                                                                <XCircle className="h-3.5 w-3.5 text-destructive" />
                                                                <span className="font-medium">{format(d.date, 'EEE, dd MMM')}:</span>
                                                                <span>Unavailable</span>
                                                            </div>
                                                        ))}
                                                    </div>

                                                </div>
                                            )}
                                            </div>
                                        </div>
                                    ))}
                                    </div>
                                ) : (
                                    <Alert className="border-dashed">
                                        <Users className="h-4 w-4" />
                                        <AlertTitle>No Operatives Available</AlertTitle>
                                        <AlertDescription>
                                        No users match the current date and filter criteria.
                                        </AlertDescription>
                                    </Alert>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </>
        )}
      </CardContent>
    </Card>
  );
}
