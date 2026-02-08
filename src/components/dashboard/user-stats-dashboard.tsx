'use client';

import type { Shift } from '@/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { CheckCircle2, History, Percent, XCircle, Camera } from 'lucide-react';
import { useMemo } from 'react';

interface UserStatsDashboardProps {
  allShifts?: Shift[];
  totalShifts?: number;
  completedShifts?: number;
  incompleteShifts?: number;
  photosUploaded?: number;
  completionRate?: number;
  incompleteRate?: number;
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

export function UserStatsDashboard({ 
    allShifts,
    totalShifts: totalProp,
    completedShifts: completedProp,
    incompleteShifts: incompleteProp,
    photosUploaded: photosProp,
    completionRate: completionRateProp,
    incompleteRate: incompleteRateProp,
}: UserStatsDashboardProps) {

    const stats = useMemo(() => {
        if (totalProp !== undefined && completedProp !== undefined && incompleteProp !== undefined && completionRateProp !== undefined && incompleteRateProp !== undefined) {
            return {
                totalShifts: totalProp,
                completedShifts: completedProp,
                incompleteShifts: incompleteProp,
                photosUploaded: photosProp || 0,
                completionRate: completionRateProp,
                incompleteRate: incompleteRateProp,
            };
        }

        const safeAllShifts = allShifts || [];
        const totalShifts = safeAllShifts.length;
        const completedShifts = safeAllShifts.filter(s => s.status === 'completed').length;
        const incompleteShifts = safeAllShifts.filter(s => s.status === 'incomplete').length;
        const rateCalculationTotal = completedShifts + incompleteShifts;
        const completionRate = rateCalculationTotal > 0 ? (completedShifts / rateCalculationTotal) * 100 : 0;
        const incompleteRate = rateCalculationTotal > 0 ? (incompleteShifts / rateCalculationTotal) * 100 : 0;

        return {
            totalShifts,
            completedShifts,
            incompleteShifts,
            photosUploaded: photosProp || 0,
            completionRate,
            incompleteRate,
        };
    }, [allShifts, totalProp, completedProp, incompleteProp, photosProp, completionRateProp, incompleteRateProp]);

    return (
        <div>
            <h3 className="text-lg font-semibold tracking-tight mb-2">Your Personal Stats</h3>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <StatCard title="Total Shifts" value={stats.totalShifts} icon={History} />
                <StatCard title="Completed" value={stats.completedShifts} icon={CheckCircle2} />
                <StatCard title="Incomplete" value={stats.incompleteShifts} icon={XCircle} />
                <StatCard title="Photos Uploaded" value={stats.photosUploaded} icon={Camera} />
                <StatCard title="Completion Rate" value={`${stats.completionRate.toFixed(0)}%`} icon={Percent} />
                <StatCard title="Incompletion Rate" value={`${stats.incompleteRate.toFixed(0)}%`} icon={Percent} />
            </div>
        </div>
    );
}
