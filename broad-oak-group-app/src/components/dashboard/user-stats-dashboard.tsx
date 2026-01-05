
'use client';

import type { Shift } from '@/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { CheckCircle2, History, Percent, XCircle } from 'lucide-react';
import { useMemo } from 'react';

interface UserStatsDashboardProps {
  allShifts: Shift[];
}

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

export function UserStatsDashboard({ allShifts }: UserStatsDashboardProps) {

    const stats = useMemo(() => {
        const totalShifts = allShifts.length;
        const completedShifts = allShifts.filter(s => s.status === 'completed').length;
        const incompleteShifts = allShifts.filter(s => s.status === 'incomplete').length;
        const completionRate = totalShifts > 0 ? (completedShifts / totalShifts) * 100 : 0;

        return {
            totalShifts,
            completedShifts,
            incompleteShifts,
            completionRate
        };
    }, [allShifts]);

    return (
        <div>
            <h3 className="text-md font-semibold tracking-tight mb-2">Your All-Time Stats</h3>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <StatCard title="Total Shifts" value={stats.totalShifts} icon={History} />
                <StatCard title="Completed" value={stats.completedShifts} icon={CheckCircle2} />
                <StatCard title="Incomplete" value={stats.incompleteShifts} icon={XCircle} />
                <StatCard title="Completion Rate" value={`${stats.completionRate.toFixed(0)}%`} icon={Percent} />
            </div>
        </div>
    );
}

    
