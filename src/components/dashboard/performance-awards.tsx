
'use client';

import { useMemo } from 'react';
import { startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';
import { Award, Medal, Trophy } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import type { Shift, UserProfile } from '@/types';
import { getCorrectedLocalDate, isWithin } from '@/lib/utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Avatar, AvatarFallback } from '../ui/avatar';


interface PerformanceAwardsProps {
    allShifts: Shift[];
    allUsers: UserProfile[];
}

interface PerformanceMetric {
    userId: string;
    userName: string;
    completionRate: number;
}

const getInitials = (name?: string) => {
    if (!name) return '??';
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase();
};

const LeaderboardColumn = ({ title, performers }: { title: string, performers: PerformanceMetric[] }) => {
    const medalColors = [
        'text-amber-500', // Gold
        'text-slate-400', // Silver
        'text-amber-700'  // Bronze
    ];

    return (
        <Card className="flex flex-col">
            <CardHeader>
                <CardTitle className="text-lg">{title}</CardTitle>
            </CardHeader>
            <CardContent className="flex-grow">
                {performers.length > 0 ? (
                     <Table>
                        <TableBody>
                            {performers.map((p, index) => (
                                <TableRow key={p.userId} className={index === 0 ? 'bg-muted/50' : ''}>
                                    <TableCell className="w-10">
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
                                    <TableCell className="text-right font-bold tabular-nums">
                                        {p.completionRate.toFixed(0)}%
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                ) : (
                    <p className="text-sm text-muted-foreground text-center pt-8">No data for this period.</p>
                )}
            </CardContent>
        </Card>
    )
};

export function PerformanceAwards({ allShifts, allUsers }: PerformanceAwardsProps) {

    const calculateTopPerformers = (shifts: Shift[], users: UserProfile[]): PerformanceMetric[] => {
        const userProfiles = users.filter(u => u.role === 'user');
        if (userProfiles.length === 0 || shifts.length === 0) return [];

        const metrics = userProfiles.map(user => {
            const userShifts = shifts.filter(s => s.userId === user.uid);
            if (userShifts.length === 0) return null;

            const completed = userShifts.filter(s => s.status === 'completed').length;
            // Base the rate on all assigned shifts, except those the user hasn't even confirmed yet.
            const rateCalculationTotal = userShifts.filter(s => s.status !== 'pending-confirmation').length;
            
            if (rateCalculationTotal === 0) return null;

            const completionRate = (completed / rateCalculationTotal) * 100;

            return { userId: user.uid, userName: user.name, completionRate };
        }).filter((m): m is PerformanceMetric => m !== null && m.completionRate > 0);
        
        return metrics.sort((a, b) => b.completionRate - a.completionRate).slice(0, 3);
    };

    const { weeklyTop, monthlyTop, allTimeTop } = useMemo(() => {
        const now = new Date();
        
        const startOfThisWeek = startOfWeek(now, { weekStartsOn: 1 });
        const endOfThisWeek = endOfWeek(now, { weekStartsOn: 1 });
        const weeklyShifts = allShifts.filter(s => {
            const shiftDate = getCorrectedLocalDate(s.date);
            return isWithin(shiftDate, { start: startOfThisWeek, end: endOfThisWeek });
        });
        
        const startOfThisMonth = startOfMonth(now);
        const endOfThisMonth = endOfMonth(now);
        const monthlyShifts = allShifts.filter(s => {
             const shiftDate = getCorrectedLocalDate(s.date);
            return isWithin(shiftDate, { start: startOfThisMonth, end: endOfThisMonth });
        });

        return {
            weeklyTop: calculateTopPerformers(weeklyShifts, allUsers),
            monthlyTop: calculateTopPerformers(monthlyShifts, allUsers),
            allTimeTop: calculateTopPerformers(allShifts, allUsers),
        };
    }, [allShifts, allUsers]);

    if (allUsers.length === 0 || allShifts.length === 0) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Team Leaderboard</CardTitle>
                    <CardDescription>Recognizing the top performers on the team based on shift completion rates.</CardDescription>
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
                <div className="grid gap-6 md:grid-cols-3">
                    <LeaderboardColumn title="Weekly Top 3" performers={weeklyTop} />
                    <LeaderboardColumn title="Monthly Top 3" performers={monthlyTop} />
                    <LeaderboardColumn title="All-Time Top 3" performers={allTimeTop} />
                </div>
            </CardContent>
        </Card>
    );
}
