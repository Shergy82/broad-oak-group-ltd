'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Shift, UserProfile, Project, ProjectFile } from '@/types';
import { startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear } from 'date-fns';
import { useAuth } from '@/hooks/use-auth';
import { useRouter } from 'next/navigation';
import { Spinner } from '@/components/shared/spinner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Leaderboard } from '@/components/stats/leaderboard';
import { UserStatsDashboard } from '@/components/dashboard/user-stats-dashboard';
import { getCorrectedLocalDate, isWithin } from '@/lib/utils';
import { Award } from 'lucide-react';

export interface PerformanceMetric {
  userId: string;
  userName: string;
  totalShifts: number;
  completedShifts: number;
  incompleteShifts: number;
  photosUploaded: number;
  completionRate: number;
}

export default function StatsPage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const router = useRouter();

  const [allShifts, setAllShifts] = useState<Shift[]>([]);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [allPhotos, setAllPhotos] = useState<ProjectFile[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    if (!isAuthLoading && !user) {
      router.push('/login');
    }
  }, [user, isAuthLoading, router]);

  useEffect(() => {
    if (!user || !db) {
      setLoadingData(false);
      return;
    }

    setLoadingData(true);
    let shiftsLoaded = false;
    let usersLoaded = false;
    let photosLoaded = false;

    const checkAllDataLoaded = () => {
      if (shiftsLoaded && usersLoaded && photosLoaded) {
        setLoadingData(false);
      }
    };

    const unsubShifts = onSnapshot(query(collection(db, 'shifts')), (snapshot) => {
      setAllShifts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Shift)));
      shiftsLoaded = true;
      checkAllDataLoaded();
    });

    const unsubUsers = onSnapshot(query(collection(db, 'users')), (snapshot) => {
      setAllUsers(snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile)));
      usersLoaded = true;
      checkAllDataLoaded();
    });

    const fetchPhotos = async () => {
        try {
            const projectsSnapshot = await getDocs(query(collection(db, 'projects')));
            const photoPromises = projectsSnapshot.docs.map(async (projectDoc) => {
                const filesQuery = query(collection(db, `projects/${projectDoc.id}/files`), where('type', '>=', 'image/'), where('type', '<', 'image/~'));
                const filesSnapshot = await getDocs(filesQuery);
                return filesSnapshot.docs.map(fileDoc => ({ id: fileDoc.id, ...fileDoc.data() } as ProjectFile));
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
  }, [user]);

  const calculateMetrics = (shifts: Shift[], users: UserProfile[], photos: ProjectFile[]): PerformanceMetric[] => {
    const operativeUsers = users.filter(u => u.role === 'user');

    return operativeUsers.map(op => {
      const userShifts = shifts.filter(s => s.userId === op.uid);
      const userPhotos = photos.filter(p => p.uploaderId === op.uid);
      
      const totalShifts = userShifts.length;
      const completedShifts = userShifts.filter(s => s.status === 'completed').length;
      const incompleteShifts = userShifts.filter(s => s.status === 'incomplete').length;
      
      const rateCalculationTotal = userShifts.filter(s => s.status !== 'pending-confirmation').length;
      const completionRate = rateCalculationTotal > 0 ? (completedShifts / rateCalculationTotal) * 100 : 0;

      return {
        userId: op.uid,
        userName: op.name,
        totalShifts,
        completedShifts,
        incompleteShifts,
        photosUploaded: userPhotos.length,
        completionRate,
      };
    });
  };

  const { weeklyData, monthlyData, yearlyData } = useMemo(() => {
    if (loadingData) return { weeklyData: [], monthlyData: [], yearlyData: [] };
    
    const now = new Date();

    const weeklyInterval = { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) };
    const monthlyInterval = { start: startOfMonth(now), end: endOfMonth(now) };
    const yearlyInterval = { start: startOfYear(now), end: endOfYear(now) };

    const filterByInterval = (items: (Shift | ProjectFile)[], interval: { start: Date; end: Date; }) => {
        return items.filter(item => {
            const itemDate = getCorrectedLocalDate('uploadedAt' in item ? item.uploadedAt : item.date);
            return isWithin(itemDate, interval);
        });
    };

    const weeklyShifts = filterByInterval(allShifts, weeklyInterval) as Shift[];
    const weeklyPhotos = filterByInterval(allPhotos, weeklyInterval) as ProjectFile[];
    
    const monthlyShifts = filterByInterval(allShifts, monthlyInterval) as Shift[];
    const monthlyPhotos = filterByInterval(allPhotos, monthlyInterval) as ProjectFile[];

    const yearlyShifts = filterByInterval(allShifts, yearlyInterval) as Shift[];
    const yearlyPhotos = filterByInterval(allPhotos, yearlyInterval) as ProjectFile[];

    return {
      weeklyData: calculateMetrics(weeklyShifts, allUsers, weeklyPhotos),
      monthlyData: calculateMetrics(monthlyShifts, allUsers, monthlyPhotos),
      yearlyData: calculateMetrics(yearlyShifts, allUsers, yearlyPhotos),
    };
  }, [loadingData, allShifts, allUsers, allPhotos]);
  
  const currentUserStats = useMemo(() => {
    if (!user) return null;
    const findStats = (data: PerformanceMetric[]) => data.find(d => d.userId === user.uid);
    return {
        weekly: findStats(weeklyData),
        monthly: findStats(monthlyData),
        yearly: findStats(yearlyData)
    }
  }, [user, weeklyData, monthlyData, yearlyData]);

  if (isAuthLoading || loadingData || !user) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center">
        <Spinner size="lg" />
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col gap-6 p-4 md:p-8">
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Award className="h-6 w-6 text-primary"/>
                    Performance Statistics
                </CardTitle>
                <CardDescription>View weekly, monthly, and yearly performance leaderboards and your personal stats.</CardDescription>
            </CardHeader>
            <CardContent>
                <Tabs defaultValue="weekly">
                    <TabsList className="grid w-full grid-cols-3">
                        <TabsTrigger value="weekly">This Week</TabsTrigger>
                        <TabsTrigger value="monthly">This Month</TabsTrigger>
                        <TabsTrigger value="yearly">This Year</TabsTrigger>
                    </TabsList>
                    <TabsContent value="weekly" className="mt-6">
                        <Leaderboard title="Weekly Top 5" data={weeklyData} />
                         {currentUserStats?.weekly && <div className="mt-8"><UserStatsDashboard allShifts={[]} {...currentUserStats.weekly} /></div>}
                    </TabsContent>
                    <TabsContent value="monthly" className="mt-6">
                        <Leaderboard title="Monthly Top 5" data={monthlyData} />
                         {currentUserStats?.monthly && <div className="mt-8"><UserStatsDashboard allShifts={[]} {...currentUserStats.monthly} /></div>}
                    </TabsContent>
                    <TabsContent value="yearly" className="mt-6">
                        <Leaderboard title="Yearly Top 5" data={yearlyData} />
                         {currentUserStats?.yearly && <div className="mt-8"><UserStatsDashboard allShifts={[]} {...currentUserStats.yearly} /></div>}
                    </TabsContent>
                </Tabs>
            </CardContent>
        </Card>
    </main>
  );
}