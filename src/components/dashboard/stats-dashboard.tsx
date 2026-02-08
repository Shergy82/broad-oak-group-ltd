'use client';

import { useMemo } from 'react';
import { useAuth } from '@/hooks/use-auth';
import type { Shift, UserProfile, ProjectFile } from '@/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { CheckCircle2, History, Percent, XCircle, Medal, Trophy, Camera } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Avatar, AvatarFallback } from '../ui/avatar';

interface StatsDashboardProps {
    allShifts: Shift[];
    userShifts: Shift[];
    allUsers: UserProfile[];
    allFiles: ProjectFile[];
    timeRange: 'weekly' | 'monthly' | 'yearly';
}

interface PerformanceMetric {
    userId: string;
    userName: string;
    completionRate: number;
    incompleteRate: number;
    totalShifts: number;
}

const getInitials = (name?: string) => {
    if (!name) return '??';
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase();
};

const StatCard = ({ title, value, icon: Icon }: { title: string, value: string | number, icon: React.ElementType }) => (
    <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{title}</CardTitle>
            <Icon className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
            <div className="text-xl font-bold">{value}</div>
        </CardContent>
    </Card>
);

export function StatsDashboard({ allShifts, userShifts, allUsers, allFiles, timeRange }: StatsDashboardProps) {

    const { user } = useAuth();

    const userStats = useMemo(() => {
        const totalShifts = userShifts.length;
        const completedShifts = userShifts.filter(s => s.status === 'completed').length;
        const incompleteShifts = userShifts.filter(s => s.status === 'incomplete').length;
        
        const rateCalculationTotal = userShifts.filter(s => s.status !== 'pending-confirmation').length;
        const completionRate = rateCalculationTotal > 0 ? (completedShifts / rateCalculationTotal) * 100 : 0;
        const incompleteRate = rateCalculationTotal > 0 ? (incompleteShifts / rateCalculationTotal) * 100 : 0;

        const photosUploaded = allFiles.filter(f => f.uploaderId === user?.uid && f.type?.startsWith('image/')).length;

        return {
            totalShifts,
            completedShifts,
            incompleteShifts,
            completionRate,
            incompleteRate,
            photosUploaded,
        };
    }, [userShifts, allFiles, user]);

    const topPerformers = useMemo(() => {
        const operativeUsers = allUsers.filter(u => u.role === 'user' || u.role === 'TLO');
        if (operativeUsers.length === 0 || allShifts.length === 0) return [];

        const metrics = operativeUsers.map(user => {
            const userShiftsForPeriod = allShifts.filter(s => s.userId === user.uid);
            if (userShiftsForPeriod.length === 0) return null;

            const completed = userShiftsForPeriod.filter(s => s.status === 'completed').length;
            const incomplete = userShiftsForPeriod.filter(s => s.status === 'incomplete').length;
            const rateCalculationTotal = userShiftsForPeriod.filter(s => s.status !== 'pending-confirmation').length;
            
            if (rateCalculationTotal === 0) return null;

            const completionRate = (completed / rateCalculationTotal) * 100;
            const incompleteRate = (incomplete / rateCalculationTotal) * 100;

            return { userId: user.uid, userName: user.name, completionRate, incompleteRate, totalShifts: userShiftsForPeriod.length };
        }).filter((m): m is PerformanceMetric => m !== null);
        
        return metrics.sort((a, b) => b.completionRate - a.completionRate).slice(0, 5);
    }, [allShifts, allUsers]);

    const timeRangeTitle = useMemo(() => {
        if (timeRange === 'weekly') return 'This Week';
        if (timeRange === 'monthly') return 'This Month';
        return 'This Year';
    }, [timeRange]);

    const medalColors = ['text-amber-500', 'text-slate-400', 'text-amber-700'];

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>Top 5 Performers - {timeRangeTitle}</CardTitle>
                    <CardDescription>Top operatives based on shift completion rate for the period.</CardDescription>
                </CardHeader>
                <CardContent>
                    {topPerformers.length > 0 ? (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-10"></TableHead>
                                    <TableHead>Operative</TableHead>
                                    <TableHead className="text-right">Completion %</TableHead>
                                    <TableHead className="text-right">Incomplete %</TableHead>
                                    <TableHead className="text-right">Total Shifts</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {topPerformers.map((p, index) => (
                                    <TableRow key={p.userId} className={index < 3 ? 'bg-muted/50' : ''}>
                                        <TableCell>
                                            <Medal className={`h-5 w-5 ${medalColors[index] || 'text-muted-foreground'}`} />
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-3">
                                                <Avatar className="h-8 w-8">
                                                    <AvatarFallback>{getInitials(p.userName)}</AvatarFallback>
                                                </Avatar>
                                                <span className="font-medium truncate">{p.userName}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-right font-bold tabular-nums text-green-600">
                                            {p.completionRate.toFixed(0)}%
                                        </TableCell>
                                        <TableCell className="text-right font-bold tabular-nums text-amber-600">
                                            {p.incompleteRate.toFixed(0)}%
                                        </TableCell>
                                        <TableCell className="text-right font-medium tabular-nums">
                                            {p.totalShifts}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    ) : (
                         <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center h-48">
                            <Trophy className="mx-auto h-12 w-12 text-muted-foreground" />
                            <h3 className="mt-4 text-lg font-semibold">Not Enough Data</h3>
                            <p className="mt-2 text-sm text-muted-foreground">Leaderboard data will appear here once shifts are completed.</p>
                        </div>
                    )}
                </CardContent>
            </Card>

            <div>
                <h3 className="text-lg font-semibold tracking-tight mb-2">Your Stats - {timeRangeTitle}</h3>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
                    <StatCard title="Total Shifts" value={userStats.totalShifts} icon={History} />
                    <StatCard title="Completed" value={userStats.completedShifts} icon={CheckCircle2} />
                    <StatCard title="Incomplete" value={userStats.incompleteShifts} icon={XCircle} />
                    <StatCard title="Completion Rate" value={`${userStats.completionRate.toFixed(0)}%`} icon={Percent} />
                    <StatCard title="Photos Uploaded" value={userStats.photosUploaded} icon={Camera} />
                </div>
            </div>
        </div>
    );
}
