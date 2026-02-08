'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Medal, Trophy } from 'lucide-react';
import type { PerformanceMetric } from '@/types';

interface LeaderboardProps {
  title: string;
  data: PerformanceMetric[];
}

const getInitials = (name?: string) => {
    if (!name) return '??';
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase();
};

export function Leaderboard({ title, data }: LeaderboardProps) {
    const medalColors = [
        'text-amber-400', // Gold
        'text-slate-400', // Silver
        'text-amber-600'  // Bronze
    ];

    const sortedData = [...data].sort((a, b) => {
        if (b.completionRate !== a.completionRate) {
            return b.completionRate - a.completionRate;
        }
        return b.photosUploaded - a.photosUploaded;
    }).slice(0, 5);

    return (
        <Card>
            <CardHeader>
                <CardTitle>{title}</CardTitle>
                <CardDescription>Top performers based on shift completion rate.</CardDescription>
            </CardHeader>
            <CardContent>
                {sortedData.length > 0 ? (
                    <div className="border rounded-lg">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-12">Rank</TableHead>
                                    <TableHead>Operative</TableHead>
                                    <TableHead className="text-center">Shifts</TableHead>
                                    <TableHead className="text-center">Photos</TableHead>
                                    <TableHead className="text-center">Incomplete</TableHead>
                                    <TableHead className="text-right">Completion</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {sortedData.map((p, index) => (
                                    <TableRow key={p.userId} className={index === 0 ? 'bg-muted/50' : ''}>
                                        <TableCell className="text-center">
                                            <Medal className={`mx-auto h-6 w-6 ${medalColors[index] || 'text-muted-foreground'}`} />
                                        </TableCell>
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
                                        <TableCell className="text-right font-bold text-lg text-primary tabular-nums">
                                            {p.completionRate.toFixed(0)}%
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center h-48">
                        <Trophy className="mx-auto h-12 w-12 text-muted-foreground" />
                        <h3 className="mt-4 text-lg font-semibold">No Data Yet</h3>
                        <p className="mt-2 text-sm text-muted-foreground">Performance data will appear here once shifts are completed.</p>
                    </div>
                )}
            </CardContent>
        </Card>
    );
};
