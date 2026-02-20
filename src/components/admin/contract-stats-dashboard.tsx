'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Shift, UserProfile } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { BarChart, Briefcase, User, HardHat, CheckCircle, Building } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { useUserProfile } from '@/hooks/use-user-profile';


interface ContractStats {
  name: string;
  operatives: Set<string>;
  jobs: Set<string>;
  totalShifts: number;
  completedShifts: number;
}

export function ContractStatsDashboard() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedContract, setSelectedContract] = useState('all');
  const [selectedManager, setSelectedManager] = useState('all');
  const { userProfile, loading: profileLoading } = useUserProfile();

  useEffect(() => {
    if (profileLoading) return;

    let shiftsQuery;
    if (userProfile && userProfile.role === 'owner') {
        shiftsQuery = query(collection(db, 'shifts'));
    } else if (userProfile && userProfile.department) {
        shiftsQuery = query(collection(db, 'shifts'), where('department', '==', userProfile.department));
    } else {
        setShifts([]);
        setLoading(false);
        return;
    }
    
    const unsubShifts = onSnapshot(shiftsQuery, 
      (snapshot) => {
        setShifts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Shift)));
        setLoading(false);
      },
      (err) => {
        console.error("Error fetching shifts:", err);
        setError("Could not fetch shift data.");
        setLoading(false);
      }
    );

    return () => unsubShifts();
  }, [userProfile, profileLoading]);
  
  const { availableContracts, availableManagers } = useMemo(() => {
      const contractSet = new Set<string>();
      const managerSet = new Set<string>();
      shifts.forEach(shift => {
          if (shift.contract) contractSet.add(shift.contract);
          if (shift.manager) managerSet.add(shift.manager);
      });
      return {
          availableContracts: Array.from(contractSet).sort(),
          availableManagers: Array.from(managerSet).sort(),
      };
  }, [shifts]);

  const filteredContracts = useMemo((): ContractStats[] => {
    if (loading || error) return [];

    let filteredShifts = shifts;

    if (selectedManager !== 'all') {
        filteredShifts = filteredShifts.filter(shift => shift.manager === selectedManager);
    }
    if (selectedContract !== 'all') {
        filteredShifts = filteredShifts.filter(shift => shift.contract === selectedContract);
    }
    
    const statsByContract: { [key: string]: ContractStats } = {};

    filteredShifts.forEach(shift => {
      const contractName = shift.contract || 'Uncategorized';

      if (!statsByContract[contractName]) {
        statsByContract[contractName] = {
          name: contractName,
          operatives: new Set(),
          jobs: new Set(),
          totalShifts: 0,
          completedShifts: 0,
        };
      }

      const contract = statsByContract[contractName];
      contract.operatives.add(shift.userId);
      contract.jobs.add(shift.address);
      contract.totalShifts += 1;
      if (shift.status === 'completed') {
        contract.completedShifts += 1;
      }
    });

    return Object.values(statsByContract).sort((a, b) => b.totalShifts - a.totalShifts);

  }, [shifts, loading, error, selectedManager, selectedContract]);


  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
                <CardTitle>Contract Dashboard</CardTitle>
                <CardDescription>
                  High-level statistics for each contract, derived from shift data.
                </CardDescription>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                 <Select value={selectedManager} onValueChange={setSelectedManager}>
                    <SelectTrigger className="w-full sm:w-[180px]">
                        <SelectValue placeholder="Filter by manager..." />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Managers</SelectItem>
                        {availableManagers.map(manager => <SelectItem key={manager} value={manager}>{manager}</SelectItem>)}
                    </SelectContent>
                </Select>
                 <Select value={selectedContract} onValueChange={setSelectedContract}>
                    <SelectTrigger className="w-full sm:w-[180px]">
                        <SelectValue placeholder="Filter by contract..." />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Contracts</SelectItem>
                        {availableContracts.map(contract => <SelectItem key={contract} value={contract}>{contract}</SelectItem>)}
                    </SelectContent>
                </Select>
            </div>
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <Alert variant="destructive">
            <BarChart className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        
        {loading || profileLoading ? (
             <div className="border rounded-lg"><Skeleton className="w-full h-48" /></div>
        ) : filteredContracts.length === 0 && !error ? (
            <div className="flex flex-col items-center justify-center rounded-lg p-12 text-center border border-dashed">
                <Briefcase className="mx-auto h-12 w-12 text-muted-foreground" />
                <h3 className="mt-4 text-lg font-semibold">No Contract Data Found</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                    Data will appear here once shifts with assigned managers are created.
                </p>
            </div>
        ) : (
          <>
            {/* Desktop View */}
            <div className="border rounded-lg hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Contract</TableHead>
                    <TableHead className="text-center">Jobs (Addresses)</TableHead>
                    <TableHead className="text-center">Operatives</TableHead>
                    <TableHead className="text-center">Total Shifts</TableHead>
                    <TableHead className="text-right">Completed Shifts</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredContracts.map((data) => (
                      <TableRow key={data.name}>
                        <TableCell className="font-medium">{data.name}</TableCell>
                        <TableCell className="text-center">{data.jobs.size}</TableCell>
                        <TableCell className="text-center">{data.operatives.size}</TableCell>
                        <TableCell className="text-center">{data.totalShifts}</TableCell>
                        <TableCell className="text-right">{data.completedShifts}</TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile View */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:hidden">
              {filteredContracts.map((data) => (
                <Card key={data.name}>
                  <CardHeader>
                    <CardTitle className="text-base">{data.name}</CardTitle>
                  </CardHeader>
                  <CardContent className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                     <div className="flex items-center gap-2">
                        <Building className="h-4 w-4 text-muted-foreground" />
                        <div>
                            <p className="font-medium">{data.jobs.size}</p>
                            <p className="text-muted-foreground text-xs">Jobs</p>
                        </div>
                    </div>
                     <div className="flex items-center gap-2">
                        <HardHat className="h-4 w-4 text-muted-foreground" />
                        <div>
                            <p className="font-medium">{data.operatives.size}</p>
                            <p className="text-muted-foreground text-xs">Operatives</p>
                        </div>
                    </div>
                     <div className="flex items-center gap-2">
                        <Briefcase className="h-4 w-4 text-muted-foreground" />
                        <div>
                            <p className="font-medium">{data.totalShifts}</p>
                            <p className="text-muted-foreground text-xs">Total Shifts</p>
                        </div>
                    </div>
                     <div className="flex items-center gap-2">
                        <CheckCircle className="h-4 w-4 text-muted-foreground" />
                        <div>
                            <p className="font-medium">{data.completedShifts}</p>
                            <p className="text-muted-foreground text-xs">Completed</p>
                        </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
