
'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2, History, Percent, XCircle, Camera } from 'lucide-react';

interface UserStatsDashboardProps {
  totalShifts: number;
  completedShifts: number;
  incompleteShifts: number;
  photosUploaded: number;
  completionRate: number;
  incompleteRate: number;
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
    totalShifts = 0,
    completedShifts = 0,
    incompleteShifts = 0,
    photosUploaded = 0,
    completionRate = 0,
    incompleteRate = 0,
}: UserStatsDashboardProps) {

    return (
        <div>
            <h3 className="text-lg font-semibold tracking-tight mb-2">Your Personal Stats</h3>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <StatCard title="Total Shifts" value={totalShifts} icon={History} />
                <StatCard title="Completed" value={completedShifts} icon={CheckCircle2} />
                <StatCard title="Incomplete" value={incompleteShifts} icon={XCircle} />
                <StatCard title="Photos Uploaded" value={photosUploaded} icon={Camera} />
                <StatCard title="Completion Rate" value={`${completionRate.toFixed(0)}%`} icon={Percent} />
                <StatCard title="Incompletion Rate" value={`${incompleteRate.toFixed(0)}%`} icon={Percent} />
            </div>
        </div>
    );
}
