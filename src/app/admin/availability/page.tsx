
'use client';

import { useEffect, useMemo, useState } from 'react';
import { addDays, format, startOfDay } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Shift, UserProfile } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Calendar } from '@/components/ui/calendar';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { Calendar as CalendarIcon, Users, UserCheck, Filter, ChevronDown, Check } from 'lucide-react';
import { getCorrectedLocalDate, isWithin } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem } from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

type Role = 'user' | 'admin' | 'owner';

const getInitials = (name?: string) => {
    if (!name) return '??';
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase();
};

export default function AvailabilityPage() {
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
      from: startOfDay(new Date()),
      to: startOfDay(new Date()),
  });
  const [allShifts, setAllShifts] = useState<Shift[]>([]);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedRoles, setSelectedRoles] = useState<Set<Role>>(new Set(['user', 'admin', 'owner']));
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [isUserFilterApplied, setIsUserFilterApplied] = useState(false);


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
        // Initially, select all users by default
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
          setIsUserFilterApplied(true); // Mark that a manual user selection has occurred
          return newUserIds;
      });
  };

  useEffect(() => {
    // This effect updates the user selection only when the roles change,
    // and only if the user hasn't started manually picking individuals.
    if (!isUserFilterApplied) {
        const userIdsInSelectedRoles = allUsers
            .filter(u => selectedRoles.has(u.role as Role))
            .map(u => u.uid);
        setSelectedUserIds(new Set(userIdsInSelectedRoles));
    }
  }, [selectedRoles, allUsers, isUserFilterApplied]);

  const availableUsers = useMemo(() => {
    if (!dateRange?.from || allUsers.length === 0) {
      return [];
    }
    
    const start = startOfDay(dateRange.from);
    const end = dateRange.to ? startOfDay(dateRange.to) : start;

    const interval = { start, end };
    
    const shiftsInInterval = allShifts.filter(shift => {
        const shiftDate = getCorrectedLocalDate(shift.date);
        return isWithin(shiftDate, interval);
    });

    const busyUserIds = new Set<string>();
    shiftsInInterval.forEach(shift => {
        busyUserIds.add(shift.userId);
    });
    
    return allUsers.filter(user => 
      !busyUserIds.has(user.uid) && // Not busy
      selectedRoles.has(user.role as Role) && // Role is selected
      selectedUserIds.has(user.uid) // Individual user is selected
    );

  }, [dateRange, allShifts, allUsers, selectedRoles, selectedUserIds]);

  const selectedPeriodText = () => {
    if (!dateRange?.from) return 'No date selected';
    const start = format(dateRange.from, 'PPP');
    if (!dateRange.to || format(dateRange.from, 'PPP') === format(dateRange.to, 'PPP')) {
        return `for ${start}`;
    }
    const end = format(dateRange.to, 'PPP');
    return `from ${start} to ${end}`;
  }
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>Operative Availability</CardTitle>
        <CardDescription>
          Select a date or a date range to view which operatives are available.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-1 flex justify-center">
             <Calendar
                mode="range"
                selected={dateRange}
                onSelect={setDateRange}
                className="rounded-md border"
                defaultMonth={dateRange?.from}
                numberOfMonths={1}
            />
        </div>
        <div className="md:col-span-2 space-y-6">
           <Card className="bg-muted/30">
            <CardHeader className="py-4">
              <CardTitle className="text-base flex items-center gap-2">
                <Filter className="h-4 w-4" />
                Filters
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col sm:flex-row gap-6">
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
                        <div className="flex flex-wrap gap-4">
                           {availableUsers.map(user => (
                               <div key={user.uid} className="flex items-center gap-2 p-2 border rounded-md bg-muted/50">
                                   <Avatar className="h-8 w-8">
                                       <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
                                   </Avatar>
                                   <p className="text-sm font-medium">{user.name}</p>
                               </div>
                           ))}
                        </div>
                    ) : (
                         <Alert className="border-dashed">
                            <Users className="h-4 w-4" />
                            <AlertTitle>No Operatives Available</AlertTitle>
                            <AlertDescription>
                              No users match the current date and filter criteria. Try adjusting the date range or filters.
                            </AlertDescription>
                        </Alert>
                    )}
                </div>
             </div>
           )}
        </div>
      </CardContent>
    </Card>
  );
}

