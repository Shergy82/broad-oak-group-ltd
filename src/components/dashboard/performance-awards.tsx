
'use client';

import { useMemo, useState } from 'react';
import { startOfWeek, startOfMonth, format } from 'date-fns';
import { Award, Zap, Trophy, User } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import type { Shift, UserProfile } from '@/types';
import { Skeleton } from '../ui/skeleton';

interface PerformanceAwardsProps {
    allShifts: Shift[];
    allUsers: UserProfile[];
}

interface PerformanceMetric {
    userId: string;
    userName: string;
    completionRate: number;
    avgAcceptanceTime: number | null; // in hours
}

type TimeRange = 'weekly' | 'monthly' | 'all-time';

const diffHours = (t2: any, t1: any) => {
  if (!t2 || !t1) return null;
  const diff = t2.toMillis() - t1.toMillis();
  return diff / (1000 * 60 * 60);
};

const formatDuration = (hours: number | null) => {
    if (hours === null || hours < 0) return 'N/A';
    if (hours < 1) {
        const minutes = Math.round(hours * 60);
        return `${minutes} min`;
    }
    if (hours > 24) {
        const days = Math.floor(hours / 24);
        const remainingHours = Math.round(hours % 24);
        return `${days}d ${remainingHours}h`;
    }
    return `${Math.round(hours)}h`;
};


const AwardCard = ({ title, user, value, icon: Icon, unit, lowerIsBetter = false }: { title: string, user: string, value: string, icon: React.ElementType, unit?: string, lowerIsBetter?: boolean }) => (
    <Card className="shadow-lg transform hover:scale-105 transition-transform duration-300">
        <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
                <Icon className={`h-4 w-4 ${lowerIsBetter ? 'text-blue-500' : 'text-amber-500'}`} />
                {title}
            </CardDescription>
            <CardTitle className="text-2xl">{user || 'N/A'}</CardTitle>
        </CardHeader>
        <CardContent>
            <p className="text-lg font-bold text-muted-foreground">{value}{unit}</p>
        </CardContent>
    </Card>
);


const AwardsView = ({ shifts, users, timeRange }: { shifts: Shift[], users: UserProfile[], timeRange: TimeRange }) => {

    const metrics = useMemo((): PerformanceMetric[] => {
        const userProfiles = users.filter(u => u.role === 'user');

        return userProfiles.map(user => {
            const userShifts = shifts.filter(s => s.userId === user.uid);
            const totalShifts = userShifts.length;

            const completed = userShifts.filter(s => s.status === 'completed').length;
            const completionRate = totalShifts > 0 ? (completed / totalShifts) * 100 : 0;
            
            const acceptanceTimes: number[] = [];
            userShifts.forEach(shift => {
                if (shift.confirmedAt && shift.createdAt) {
                    const time = diffHours(shift.confirmedAt, shift.createdAt);
                    if (time !== null) acceptanceTimes.push(time);
                }
            });
            const avgAcceptanceTime = acceptanceTimes.length > 0 ? acceptanceTimes.reduce((a, b) => a + b, 0) / acceptanceTimes.length : null;

            return { userId: user.uid, userName: user.name, completionRate, avgAcceptanceTime };
        });
    }, [shifts, users]);

    const topPerformer = useMemo(() => {
        if (metrics.length === 0) return null;
        return metrics.reduce((prev, current) => (prev.completionRate > current.completionRate) ? prev : current);
    }, [metrics]);

    const quickestDraw = useMemo(() => {
        const validUsers = metrics.filter(m => m.avgAcceptanceTime !== null);
        if (validUsers.length === 0) return null;
        return validUsers.reduce((prev, current) => ((prev.avgAcceptanceTime ?? Infinity) < (current.avgAcceptanceTime ?? Infinity)) ? prev : current);
    }, [metrics]);

     if (users.length === 0 || shifts.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center h-48">
                <Trophy className="mx-auto h-12 w-12 text-muted-foreground" />
                <h3 className="mt-4 text-lg font-semibold">Not Enough Data</h3>
                <p className="mt-2 text-sm text-muted-foreground">Leaderboard data will appear here once shifts are completed.</p>
            </div>
        )
    }

    return (
        <div className="grid gap-4 md:grid-cols-2">
            <AwardCard 
                title="Top Performer"
                user={topPerformer?.userName ?? 'N/A'}
                value={topPerformer ? `${topPerformer.completionRate.toFixed(0)}` : '0'}
                unit="%"
                icon={Award}
            />
            <AwardCard 
                title="Quickest on the Draw"
                user={quickestDraw?.userName ?? 'N/A'}
                value={quickestDraw ? formatDuration(quickestDraw.avgAcceptanceTime) : 'N/A'}
                icon={Zap}
                lowerIsBetter
            />
        </div>
    );
};


export function PerformanceAwards({ allShifts, allUsers }: PerformanceAwardsProps) {
    const [timeRange, setTimeRange] = useState<TimeRange>('all-time');

    const filteredData = useMemo(() => {
        const now = new Date();
        
        const weeklyShifts = allShifts.filter(s => s.createdAt && isWithin(s.createdAt.toDate(), startOfWeek(now, { weekStartsOn: 1 }), now));
        const monthlyShifts = allShifts.filter(s => s.createdAt && isWithin(s.createdAt.toDate(), startOfMonth(now), now));
        
        function isWithin(date: Date, start: Date, end: Date) {
            return date >= start && date <= end;
        }

        return {
            'weekly': { shifts: weeklyShifts, users: allUsers },
            'monthly': { shifts: monthlyShifts, users: allUsers },
            'all-time': { shifts: allShifts, users: allUsers },
        };
    }, [allShifts, allUsers]);

    return (
        <Card>
            <CardHeader>
                <CardTitle>Team Leaderboard</CardTitle>
                <CardDescription>Recognizing the top performers on the team.</CardDescription>
            </CardHeader>
            <CardContent>
                <Tabs value={timeRange} onValueChange={(value) => setTimeRange(value as TimeRange)} className="w-full">
                    <TabsList className="grid w-full grid-cols-3">
                        <TabsTrigger value="weekly">Weekly</TabsTrigger>
                        <TabsTrigger value="monthly">Monthly</TabsTrigger>
                        <TabsTrigger value="all-time">All Time</TabsTrigger>
                    </TabsList>
                    <TabsContent value="weekly" className="mt-4">
                        <AwardsView shifts={filteredData.weekly.shifts} users={filteredData.weekly.users} timeRange="weekly" />
                    </TabsContent>
                    <TabsContent value="monthly" className="mt-4">
                        <AwardsView shifts={filteredData.monthly.shifts} users={filteredData.monthly.users} timeRange="monthly" />
                    </TabsContent>
                    <TabsContent value="all-time" className="mt-4">
                         <AwardsView shifts={filteredData['all-time'].shifts} users={filteredData['all-time'].users} timeRange="all-time" />
                    </TabsContent>
                </Tabs>
            </CardContent>
        </Card>
    );
}
