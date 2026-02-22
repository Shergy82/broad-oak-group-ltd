'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where, collectionGroup, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { MaterialPurchase, Shift, UserProfile } from '@/types';
import { useUserProfile } from '@/hooks/use-user-profile';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Spinner } from '@/components/shared/spinner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertTriangle, Banknote, Calendar as CalendarIcon, Search, Users, Building, Euro } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { startOfWeek, startOfMonth, format, startOfToday, isSameDay } from 'date-fns';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';

export default function FinancePage() {
  const { userProfile, loading: profileLoading } = useUserProfile();
  const [purchases, setPurchases] = useState<MaterialPurchase[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [timeFilter, setTimeFilter] = useState('week');
  const [selectedDate, setSelectedDate] = useState<Date>();
  const [selectedUser, setSelectedUser] = useState('all');
  const [selectedSite, setSelectedSite] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  
  const handleTimeFilterChange = (value: string) => {
    setSelectedDate(undefined);
    setTimeFilter(value);
  }

  useEffect(() => {
    if (profileLoading) return;
    if (!userProfile || (userProfile.department !== 'Build' && userProfile.role !== 'owner')) {
        setLoading(false);
        return;
    }

    setLoading(true);
    let purchasesLoaded = false;
    let shiftsLoaded = false;
    let usersLoaded = false;

    const checkAllLoaded = () => {
        if (purchasesLoaded && shiftsLoaded && usersLoaded) {
            setLoading(false);
        }
    }

    const purchasesQuery = query(collectionGroup(db, 'materialPurchases'), orderBy('purchasedAt', 'desc'));
    const unsubPurchases = onSnapshot(purchasesQuery, (snapshot) => {
        setPurchases(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as MaterialPurchase)));
        purchasesLoaded = true;
        checkAllLoaded();
    }, () => {
        purchasesLoaded = true;
        checkAllLoaded();
    });
    
    let shiftsQuery;
    let usersQuery;
    
    if (userProfile.role === 'owner') {
        shiftsQuery = query(collection(db, 'shifts'));
        usersQuery = query(collection(db, 'users'));
    } else { // Build department user
        shiftsQuery = query(collection(db, 'shifts'), where('department', '==', 'Build'));
        usersQuery = query(collection(db, 'users'), where('department', '==', 'Build'));
    }
    
    const unsubShifts = onSnapshot(shiftsQuery, (snapshot) => {
        setShifts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Shift)));
        shiftsLoaded = true;
        checkAllLoaded();
    }, () => {
        shiftsLoaded = true;
        checkAllLoaded();
    });

    const unsubUsers = onSnapshot(usersQuery, (snapshot) => {
        setUsers(snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile)));
        usersLoaded = true;
        checkAllLoaded();
    }, () => {
        usersLoaded = true;
        checkAllLoaded();
    });

    return () => {
        unsubPurchases();
        unsubShifts();
        unsubUsers();
    }
  }, [userProfile, profileLoading]);

  const filteredPurchases = useMemo(() => {
    let filtered = purchases;

    // Date picker takes precedence
    if (selectedDate) {
        filtered = filtered.filter(p => isSameDay(p.purchasedAt.toDate(), selectedDate));
    } else {
        // Time filter
        const now = startOfToday();
        if (timeFilter === 'week') {
            const start = startOfWeek(now, { weekStartsOn: 1 });
            filtered = filtered.filter(p => p.purchasedAt.toDate() >= start);
        } else if (timeFilter === 'month') {
            const start = startOfMonth(now);
            filtered = filtered.filter(p => p.purchasedAt.toDate() >= start);
        }
    }


    // User filter
    if (selectedUser !== 'all') {
        filtered = filtered.filter(p => p.userId === selectedUser);
    }
    
    // Site filter (using shift address)
    if (selectedSite !== 'all') {
        const shiftIdsForSite = shifts.filter(s => s.address === selectedSite).map(s => s.id);
        const shiftIdsSet = new Set(shiftIdsForSite);
        filtered = filtered.filter(p => shiftIdsSet.has(p.shiftId));
    }

    // Search term filter
    if (searchTerm.trim()) {
        const lowercasedSearch = searchTerm.toLowerCase();
        filtered = filtered.filter(p => 
            p.supplier.toLowerCase().includes(lowercasedSearch) ||
            p.userName.toLowerCase().includes(lowercasedSearch)
        );
    }

    return filtered;
  }, [purchases, shifts, timeFilter, selectedDate, selectedUser, selectedSite, searchTerm]);

  const totalSpend = useMemo(() => {
    return filteredPurchases.reduce((acc, p) => acc + p.amount, 0);
  }, [filteredPurchases]);
  
  const uniqueSites = useMemo(() => {
      const sites = new Set(shifts.map(s => s.address));
      return Array.from(sites).sort();
  }, [shifts]);

  if (profileLoading) {
    return <div className="flex justify-center p-6"><Spinner size="lg" /></div>;
  }
  if (!userProfile || (userProfile.department !== 'Build' && userProfile.role !== 'owner')) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Access Denied</AlertTitle>
        <AlertDescription>You do not have permission to view this page. It is restricted to the Build department.</AlertDescription>
      </Alert>
    );
  }
  
  if (loading) {
      return (
          <div className="space-y-6">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-64 w-full" />
          </div>
      )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Finance Dashboard</CardTitle>
          <CardDescription>Track material purchases across projects and operatives.</CardDescription>
        </CardHeader>
        <CardContent>
            <div className="grid md:grid-cols-3 gap-4 mb-6">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Spend</CardTitle>
                        <Banknote className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">£{totalSpend.toFixed(2)}</div>
                        <p className="text-xs text-muted-foreground">for the selected period</p>
                    </CardContent>
                </Card>
                 <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Transactions</CardTitle>
                        <Euro className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{filteredPurchases.length}</div>
                         <p className="text-xs text-muted-foreground">across all filters</p>
                    </CardContent>
                </Card>
            </div>

            <div className="space-y-4">
                <div className="flex flex-col md:flex-row gap-4">
                    <Tabs value={timeFilter} onValueChange={handleTimeFilterChange} className="w-full md:w-auto">
                        <TabsList className="grid w-full grid-cols-3">
                            <TabsTrigger value="week">This Week</TabsTrigger>
                            <TabsTrigger value="month">This Month</TabsTrigger>
                            <TabsTrigger value="all">All Time</TabsTrigger>
                        </TabsList>
                    </Tabs>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 flex-grow">
                         <Popover>
                            <PopoverTrigger asChild>
                                <Button
                                    variant={"outline"}
                                    className={cn(
                                        "w-full justify-start text-left font-normal",
                                        !selectedDate && "text-muted-foreground"
                                    )}
                                >
                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                    {selectedDate ? format(selectedDate, "PPP") : <span>Pick a date</span>}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0">
                                <Calendar
                                    mode="single"
                                    selected={selectedDate}
                                    onSelect={(date) => {
                                        setSelectedDate(date as Date);
                                        if (date) {
                                            setTimeFilter(''); // Deselect tabs
                                        }
                                    }}
                                    initialFocus
                                />
                            </PopoverContent>
                        </Popover>
                         <Select value={selectedUser} onValueChange={setSelectedUser}>
                            <SelectTrigger><div className="flex items-center gap-2"><Users className="h-4 w-4 text-muted-foreground" /><span>Filter by user...</span></div></SelectTrigger>
                            <SelectContent><ScrollArea className="h-72"><SelectItem value="all">All Users</SelectItem>{users.map(u => <SelectItem key={u.uid} value={u.uid}>{u.name}</SelectItem>)}</ScrollArea></SelectContent>
                        </Select>
                         <Select value={selectedSite} onValueChange={setSelectedSite}>
                             <SelectTrigger><div className="flex items-center gap-2"><Building className="h-4 w-4 text-muted-foreground" /><span>Filter by site...</span></div></SelectTrigger>
                             <SelectContent><ScrollArea className="h-72"><SelectItem value="all">All Sites</SelectItem>{uniqueSites.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</ScrollArea></SelectContent>
                        </Select>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input placeholder="Search supplier..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-10" />
                        </div>
                    </div>
                </div>

                <div className="border rounded-lg">
                    <ScrollArea className="h-96">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Date</TableHead>
                                    <TableHead>Operative</TableHead>
                                    <TableHead>Site</TableHead>
                                    <TableHead>Supplier</TableHead>
                                    <TableHead className="text-right">Amount</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredPurchases.length > 0 ? filteredPurchases.map(p => {
                                    const shift = shifts.find(s => s.id === p.shiftId);
                                    return (
                                        <TableRow key={p.id}>
                                            <TableCell>{format(p.purchasedAt.toDate(), 'dd/MM/yyyy')}</TableCell>
                                            <TableCell>{p.userName}</TableCell>
                                            <TableCell className="truncate max-w-[200px]">{shift?.address || 'N/A'}</TableCell>
                                            <TableCell>{p.supplier}</TableCell>
                                            <TableCell className="text-right font-mono">£{p.amount.toFixed(2)}</TableCell>
                                        </TableRow>
                                    )
                                }) : (
                                    <TableRow><TableCell colSpan={5} className="h-24 text-center">No purchases match your criteria.</TableCell></TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </ScrollArea>
                </div>
            </div>
        </CardContent>
      </Card>
    </div>
  );
}
