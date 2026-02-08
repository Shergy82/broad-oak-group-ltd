'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import type { PerformanceMetric } from '@/types';

interface PersonalStatsTableProps {
  data: PerformanceMetric;
}

const getInitials = (name?: string) => {
    if (!name) return '??';
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase();
};

export function PersonalStatsTable({ data }: PersonalStatsTableProps) {
    if (!data) return null;

    return (
        <Card>
            <CardHeader>
                <CardTitle>Your Stats</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="border rounded-lg">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Operative</TableHead>
                                <TableHead className="text-center">Shifts</TableHead>
                                <TableHead className="text-center">Photos</TableHead>
                                <TableHead className="text-center">Incomplete</TableHead>
                                <TableHead className="text-center">Failed Close</TableHead>
                                <TableHead className="text-right">Completion</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            <TableRow>
                                <TableCell>
                                    <div className="flex items-center gap-3">
                                        <Avatar className="h-9 w-9">
                                            <AvatarFallback>{getInitials(data.userName)}</AvatarFallback>
                                        </Avatar>
                                        <span className="font-medium truncate">{data.userName}</span>
                                    </div>
                                </TableCell>
                                <TableCell className="text-center font-medium tabular-nums">{data.totalShifts}</TableCell>
                                <TableCell className="text-center font-medium tabular-nums">{data.photosUploaded}</TableCell>
                                <TableCell className="text-center font-medium tabular-nums text-amber-600">{data.incompleteRate.toFixed(0)}%</TableCell>
                                <TableCell className="text-center font-medium tabular-nums text-red-600">{data.failedToCloseShifts}</TableCell>
                                <TableCell className="text-right font-bold text-lg text-primary tabular-nums">
                                    {data.completionRate.toFixed(0)}%
                                </TableCell>
                            </TableRow>
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>
    );
};
