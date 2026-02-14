

'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, getDocs, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Shift, UserProfile, ProjectFile, PerformanceMetric } from '@/types';
import { isBefore, startOfToday } from 'date-fns';
import { getCorrectedLocalDate } from '@/lib/utils';
import { useUserProfile } from '@/hooks/use-user-profile';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BarChart, Trophy } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { RoleKpiDashboard } from './role-kpi-dashboard';

const getInitials = (name?: string) => {
    if (!name) return '??';
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase();
};

const PerformanceTable = ({ users }: { users: PerformanceMetric[] }) => {
    if (users.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center h-48">
                <Trophy className="mx-auto h-12 w-12 text-muted-foreground" />
                <h3 className="mt-4 text-lg font-semibold">No Data Yet</h3>
                <p className="mt-2 text-sm text-muted-foreground">No performance data for this user group.</p>
            </div>
        )
    }

    return (
        <div className="border rounded-lg">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Operative</TableHead>
                        <TableHead className="text-center">Shifts</TableHead>
                        <TableHead className="text-center">Photos</TableHead>
                        <TableHead className="text-center">Incomplete</TableHead>
                        <TableHead className="text-center">Failed Close</TableHead>
                        <TableHead className="text-right">Completion</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {users.map((p) => (
                        <TableRow key={p.userId}>
                            <TableCell>
                                <div className="flex items-center gap-3">
                                    <Avatar className="h-9 w-9">
                                        <AvatarFallback>{getInitials(p.userName)}</AvatarFallback>
                                    </Avatar>
                                    <span className="font-medium truncate">{p.userName}</span>
                                </div>
                            </TableCell>
                            <TableCell className="text-center font-medium tabular-nums">{p.totalShifts}</TableCell>
                            <TableCell className="text-center font-medium tabular-nums">{p.photosUploaded}</TableCell>
                            <TableCell className="text-center font-medium tabular-nums text-amber-600">{p.incompleteRate.toFixed(0)}%</TableCell>
                            <TableCell className="text-center font-medium tabular-nums text-red-600">{p.failedToCloseShifts}</TableCell>
                            <TableCell className="text-right font-bold text-lg text-primary tabular-nums">
                                {p.completionRate.toFixed(0)}%
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}


export function PerformanceDashboard() {
  const [allShifts, setAllShifts] = useState<Shift[]>([]);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [allPhotos, setAllPhotos] = useState<ProjectFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { userProfile } = useUserProfile();

   useEffect(() => {
    if (!userProfile) return;

    setLoading(true);
    let shiftsLoaded = false, usersLoaded = false, photosLoaded = false;
    const department = userProfile.department;
    const isOwner = userProfile.role === 'owner';

    const checkAllDataLoaded = () => {
      if (shiftsLoaded && usersLoaded && photosLoaded) {
        setLoading(false);
      }
    };
    
    let shiftsQuery;
    if (isOwner) {
        shiftsQuery = query(collection(db, 'shifts'));
    } else if (department) {
        shiftsQuery = query(collection(db, 'shifts'), where('department', '==', department));
    } else {
        shiftsLoaded = true;
        checkAllDataLoaded();
        return;
    }

    const unsubShifts = onSnapshot(shiftsQuery, (snapshot) => {
      setAllShifts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Shift)));
      shiftsLoaded = true;
      checkAllDataLoaded();
    }, (err) => { setError("Could not load shifts."); shiftsLoaded = true; checkAllDataLoaded(); });

    let usersQuery;
     if (isOwner) {
        usersQuery = query(collection(db, 'users'));
    } else if (department) {
        usersQuery = query(collection(db, 'users'), where('department', '==', department));
    } else {
        usersLoaded = true;
        checkAllDataLoaded();
        return;
    }

    const unsubUsers = onSnapshot(usersQuery, (snapshot) => {
      setAllUsers(snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile)));
      usersLoaded = true;
      checkAllDataLoaded();
    }, (err) => { setError("Could not load users."); usersLoaded = true; checkAllDataLoaded(); });

    const fetchPhotos = async () => {
        try {
            let projectsQuery;
            if (isOwner) {
                projectsQuery = query(collection(db, 'projects'));
            } else if (department) {
                projectsQuery = query(collection(db, 'projects'), where('department', '==', department));
            } else {
                photosLoaded = true;
                checkAllDataLoaded();
                return;
            }

            const projectsSnapshot = await getDocs(projectsQuery);
            const photoPromises = projectsSnapshot.docs.map(async (projectDoc) => {
                const filesQuery = query(collection(db, `projects/${projectDoc.id}/files`));
                const filesSnapshot = await getDocs(filesQuery);
                return filesSnapshot.docs.map(fileDoc => ({ id: fileDoc.id, ...fileDoc.data() } as ProjectFile))
                                        .filter(file => file.type?.startsWith('image/'));
            });
            const photosByProject = await Promise.all(photoPromises);
            setAllPhotos(photosByProject.flat());
        } catch (e) {
            console.error("Failed to fetch photo data", e);
        } finally {
            photosLoaded = true;
            checkAllDataLoaded();
        }
    };

    fetchPhotos();

    return () => {
      unsubShifts();
      unsubUsers();
    };
  }, [userProfile]);

  const { operativesData } = useMemo(() => {
    if (loading) return { operativesData: [] };

    const calculateMetrics = (users: UserProfile[]): PerformanceMetric[] => {
        const today = startOfToday();
        return users.map(op => {
            const userShifts = allShifts.filter(s => s.userId === op.uid);
            const userPhotos = allPhotos.filter(p => p.uploaderId === op.uid);
            
            const totalShifts = userShifts.length;
            const completedShifts = userShifts.filter(s => s.status === 'completed').length;
            const incompleteShifts = userShifts.filter(s => s.status === 'incomplete').length;
            
            const failedToCloseShifts = userShifts.filter(s => {
                const shiftDate = getCorrectedLocalDate(s.date);
                return isBefore(shiftDate, today) && !['completed', 'incomplete', 'rejected'].includes(s.status);
            }).length;
            
            const rateCalculationTotal = completedShifts + incompleteShifts;
            const completionRate = rateCalculationTotal > 0 ? (completedShifts / rateCalculationTotal) * 100 : 0;
            const incompleteRate = rateCalculationTotal > 0 ? (incompleteShifts / rateCalculationTotal) * 100 : 0;

            return {
                userId: op.uid,
                userName: op.name,
                totalShifts,
                completedShifts,
                incompleteShifts,
                photosUploaded: userPhotos.length,
                completionRate,
                incompleteRate,
                failedToCloseShifts,
            };
        }).sort((a, b) => {
            if (b.completionRate !== a.completionRate) return b.completionRate - a.completionRate;
            if (a.failedToCloseShifts !== b.failedToCloseShifts) return a.failedToCloseShifts - b.failedToCloseShifts;
            return b.photosUploaded - a.photosUploaded;
        });
    };
    
    const operatives = allUsers.filter(u => u.role === 'user' || u.role === 'TLO');
    
    return {
        operativesData: calculateMetrics(operatives),
    }

  }, [loading, allShifts, allUsers, allPhotos]);


  return (
    <Card>
      <CardHeader>
        <CardTitle>Operative Performance</CardTitle>
        <CardDescription>
          A full overview of performance KPIs for all users, ranked from best to worst.
        </CardDescription>
      </CardHeader>
      <CardContent>
         {error && (
          <Alert variant="destructive">
            <BarChart className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {loading ? (
            <div className="border rounded-lg">
                <Skeleton className="w-full h-96" />
            </div>
        ) : (
            <Tabs defaultValue="operatives">
                <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="operatives">Operatives</TabsTrigger>
                    <TabsTrigger value="other-staff">Other Staff</TabsTrigger>
                </TabsList>
                <TabsContent value="operatives" className="mt-6">
                    <PerformanceTable users={operativesData} />
                </TabsContent>
                <TabsContent value="other-staff" className="mt-6">
                    <RoleKpiDashboard allShifts={allShifts} allUsers={allUsers} />
                </TabsContent>
            </Tabs>
        )}
      </CardContent>
    </Card>
  );
}
