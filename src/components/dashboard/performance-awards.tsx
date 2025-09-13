
'use client';

import { useMemo } from 'react';
import { startOfWeek, endOfWeek, startOfMonth, endOfMonth, isWithinInterval } from 'date-fns';
import { Award } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import type { Shift, UserProfile } from '@/types';
import { Trophy } from 'lucide-react';

interface PerformanceAwardsProps {
    allShifts: Shift[];
    allUsers: UserProfile[];
}

interface PerformanceMetric {
    userId: string;
    userName: string;
    completionRate: number;
}

const AwardCard = ({ title, user, value, icon: Icon, unit }: { title: string, user: string, value: string, icon: React.ElementType, unit?: string }) => (
    <Card className="shadow-lg transform hover:scale-105 transition-transform duration-300">
        <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-amber-500" />
                {title}
            </CardDescription>
            <CardTitle className="text-2xl truncate">{user || 'N/A'}</CardTitle>
        </CardHeader>
        <CardContent>
            <p className="text-lg font-bold text-muted-foreground">{value}{unit}</p>
        </CardContent>
    </Card>
);

export function PerformanceAwards({ allShifts, allUsers }: PerformanceAwardsProps) {

    const calculateTopPerformer = (shifts: Shift[], users: UserProfile[]): PerformanceMetric | null => {
        const userProfiles = users.filter(u => u.role === 'user');
        if (userProfiles.length === 0 || shifts.length === 0) return null;

        const metrics = userProfiles.map(user => {
            const userShifts = shifts.filter(s => s.userId === user.uid);
            const totalShifts = userShifts.length;
            const completed = userShifts.filter(s => s.status === 'completed').length;
            const completionRate = totalShifts > 0 ? (completed / totalShifts) * 100 : 0;

            return { userId: user.uid, userName: user.name, completionRate };
        }).filter(m => m.completionRate > 0);
        
        if (metrics.length === 0) return null;

        return metrics.reduce((prev, current) => (prev.completionRate >= current.completionRate) ? prev : current);
    };

    const { weeklyTop, monthlyTop, allTimeTop } = useMemo(() => {
        const now = new Date();
        
        // Weekly: Monday to Sunday of the current week.
        const startOfThisWeek = startOfWeek(now, { weekStartsOn: 1 });
        const endOfThisWeek = endOfWeek(now, { weekStartsOn: 1 });
        const weeklyShifts = allShifts.filter(s => {
            if (!s.createdAt) return false;
            const shiftDate = s.createdAt.toDate();
            return isWithinInterval(shiftDate, { start: startOfThisWeek, end: endOfThisWeek });
        });

        // Monthly: First day to last day of the current month.
        const monthlyShifts = allShifts.filter(s => s.createdAt && isWithinInterval(s.createdAt.toDate(), { start: startOfMonth(now), end: endOfMonth(now) }));

        return {
            weeklyTop: calculateTopPerformer(weeklyShifts, allUsers),
            monthlyTop: calculateTopPerformer(monthlyShifts, allUsers),
            allTimeTop: calculateTopPerformer(allShifts, allUsers),
        };
    }, [allShifts, allUsers]);

    if (allUsers.length === 0 || allShifts.length === 0) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Team Leaderboard</CardTitle>
                    <CardDescription>Recognizing the top performers on the team.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center h-48">
                        <Trophy className="mx-auto h-12 w-12 text-muted-foreground" />
                        <h3 className="mt-4 text-lg font-semibold">Not Enough Data</h3>
                        <p className="mt-2 text-sm text-muted-foreground">Leaderboard data will appear here once shifts are completed.</p>
                    </div>
                </CardContent>
            </Card>
        )
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Team Leaderboard</CardTitle>
                <CardDescription>Recognizing the top performers on the team based on shift completion rates.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="grid gap-4 md:grid-cols-3">
                    <AwardCard
                        title="Top Performer (Weekly)"
                        user={weeklyTop?.userName ?? 'N/A'}
                        value={weeklyTop ? `${weeklyTop.completionRate.toFixed(0)}` : '0'}
                        unit="%"
                        icon={Award}
                    />
                    <AwardCard
                        title="Top Performer (Monthly)"
                        user={monthlyTop?.userName ?? 'N/A'}
                        value={monthlyTop ? `${monthlyTop.completionRate.toFixed(0)}` : '0'}
                        unit="%"
                        icon={Award}
                    />
                    <AwardCard
                        title="Top Performer (All Time)"
                        user={allTimeTop?.userName ?? 'N/A'}
                        value={allTimeTop ? `${allTimeTop.completionRate.toFixed(0)}` : '0'}
                        unit="%"
                        icon={Award}
                    />
                </div>
            </CardContent>
        </Card>
    );
}
