'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, getDocs, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Shift, UserProfile, ProjectFile, PerformanceMetric } from '@/types';
import { startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear, isBefore, startOfToday } from 'date-fns';
import { useAuth } from '@/hooks/use-auth';
import { useRouter } from 'next/navigation';
import { Spinner } from '@/components/shared/spinner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Leaderboard } from '@/components/stats/leaderboard';
import { PersonalStatsTable } from '@/components/stats/personal-stats-table';
import { getCorrectedLocalDate, isWithin } from '@/lib/utils';
import { Award } from 'lucide-react';
import { useUserProfile } from '@/hooks/use-user-profile';
import { useDepartmentFilter } from '@/hooks/use-department-filter';


export default function StatsPage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const { userProfile, loading: profileLoading } = useUserProfile();
  const router = useRouter();

  const [allShifts, setAllShifts] = useState<Shift[]>([]);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [allPhotos, setAllPhotos] = useState<ProjectFile[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const { selectedDepartments } = useDepartmentFilter();

  useEffect(() => {
    if (!isAuthLoading && !user) {
      router.push('/login');
    }
  }, [user, isAuthLoading, router]);

  useEffect(() => {
    if (!user || !db || profileLoading || !userProfile) {
      if (!isAuthLoading && !profileLoading) setLoadingData(false);
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
    
    const department = userProfile.department;
    const isOwner = userProfile.role === 'owner';

    let shiftsQuery;
    if (isOwner) {
        shiftsQuery = query(collection(db, 'shifts'));
    } else if (department) {
        shiftsQuery = query(collection(db, 'shifts'), where('department', '==', department));
    } else {
        shiftsQuery = query(collection(db, 'shifts'), where('userId', '==', userProfile.uid));
    }
    const unsubShifts = onSnapshot(shiftsQuery, (snapshot) => {
      setAllShifts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Shift)));
      shiftsLoaded = true;
      checkAllDataLoaded();
    });

    let usersQuery;
    if (isOwner) {
        usersQuery = query(collection(db, 'users'));
    } else if (department) {
        usersQuery = query(collection(db, 'users'), where('department', '==', department));
    } else {
        usersQuery = query(collection(db, 'users'), where('uid', '==', userProfile.uid));
    }
    const unsubUsers = onSnapshot(usersQuery, (snapshot) => {
      setAllUsers(snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile)));
      usersLoaded = true;
      checkAllDataLoaded();
    });

    const fetchPhotos = async () => {
        try {
            let projectsQuery;
            if (isOwner) {
                projectsQuery = query(collection(db, 'projects'));
            } else if (department) {
                projectsQuery = query(collection(db, 'projects'), where('department', '==', department));
            } else {
                setAllPhotos([]);
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
  }, [user, userProfile, profileLoading]);
  
  const departmentFilteredUsers = useMemo(() => {
      if (userProfile?.role !== 'owner') {
          return allUsers;
      }
      return allUsers.filter(u => u.department && selectedDepartments.has(u.department));
  }, [allUsers, userProfile, selectedDepartments]);


  const calculateMetrics = (shifts: Shift[], users: UserProfile[], photos: ProjectFile[]): PerformanceMetric[] => {
    const operativeUsers = users.filter(u => u.role === 'user' || u.role === 'TLO');
    const today = startOfToday();

    return operativeUsers.map(op => {
      const userShifts = shifts.filter(s => s.userId === op.uid);
      const userPhotos = photos.filter(p => p.uploaderId === op.uid);
      
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
      weeklyData: calculateMetrics(weeklyShifts, departmentFilteredUsers, weeklyPhotos),
      monthlyData: calculateMetrics(monthlyShifts, departmentFilteredUsers, monthlyPhotos),
      yearlyData: calculateMetrics(yearlyShifts, departmentFilteredUsers, yearlyPhotos),
    };
  }, [loadingData, allShifts, allPhotos, departmentFilteredUsers]);
  
  const currentUserStats = useMemo(() => {
    if (!user) return null;
    const findStats = (data: PerformanceMetric[]) => data.find(d => d.userId === user.uid);
    return {
        weekly: findStats(weeklyData),
        monthly: findStats(monthlyData),
        yearly: findStats(yearlyData)
    }
  }, [user, weeklyData, monthlyData, yearlyData]);

  if (isAuthLoading || profileLoading || loadingData || !user) {
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
                    <TabsContent value="weekly" className="mt-6 space-y-8">
                        <Leaderboard title="Weekly Top 5" data={weeklyData} />
                        {currentUserStats?.weekly && <PersonalStatsTable data={currentUserStats.weekly} />}
                    </TabsContent>
                    <TabsContent value="monthly" className="mt-6 space-y-8">
                        <Leaderboard title="Monthly Top 5" data={monthlyData} />
                        {currentUserStats?.monthly && <PersonalStatsTable data={currentUserStats.monthly} />}
                    </TabsContent>
                    <TabsContent value="yearly" className="mt-6 space-y-8">
                        <Leaderboard title="Yearly Top 5" data={yearlyData} />
                        {currentUserStats?.yearly && <PersonalStatsTable data={currentUserStats.yearly} />}
                    </TabsContent>
                </Tabs>
            </CardContent>
        </Card>
    </main>
  );
}
