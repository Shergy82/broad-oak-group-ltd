'use client';

import { useState, useEffect } from 'react';
import { collection, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { FunctionLog } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { Spinner } from '@/components/shared/spinner';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AlertCircle, Info, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

const getLevelBadge = (level: 'info' | 'warn' | 'error') => {
    switch (level) {
        case 'info':
            return <Badge variant="secondary"><Info className="mr-1 h-3 w-3" /> Info</Badge>;
        case 'warn':
            return <Badge variant="default" className="bg-amber-500 hover:bg-amber-600"><AlertCircle className="mr-1 h-3 w-3" /> Warn</Badge>;
        case 'error':
            return <Badge variant="destructive"><AlertCircle className="mr-1 h-3 w-3" /> Error</Badge>;
        default:
            return <Badge variant="outline">Unknown</Badge>;
    }
}

export default function NotificationLogsPage() {
    const [logs, setLogs] = useState<FunctionLog[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!db) {
            setLoading(false);
            return;
        }

        const q = query(collection(db, 'function_logs'), orderBy('timestamp', 'desc'), limit(50));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetchedLogs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as FunctionLog));
            setLogs(fetchedLogs);
            setLoading(false);
        }, (error) => {
            console.error("Error fetching logs:", error);
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);
    
    const refreshPage = () => {
        window.location.reload();
    }

    return (
        <Card>
            <CardHeader>
                <div className="flex justify-between items-center">
                    <div>
                        <CardTitle>Notification Function Logs</CardTitle>
                        <CardDescription>
                            Real-time diagnostic logs from the backend notification function. Create a new shift to see new logs appear.
                        </CardDescription>
                    </div>
                     <Button onClick={refreshPage} variant="outline" size="sm">
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Refresh
                    </Button>
                </div>
            </CardHeader>
            <CardContent>
                {loading ? (
                    <div className="flex justify-center items-center h-48">
                        <Spinner size="lg" />
                    </div>
                ) : logs.length === 0 ? (
                    <p className="text-center text-muted-foreground p-8">No logs found yet. Trigger a function to see data here.</p>
                ) : (
                    <ScrollArea className="h-[70vh] border rounded-md">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Time</TableHead>
                                    <TableHead>Level</TableHead>
                                    <TableHead>Message</TableHead>
                                    <TableHead>Details</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {logs.map(log => (
                                    <TableRow key={log.id}>
                                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                                            {log.timestamp ? format(log.timestamp.toDate(), 'p') : '...'}
                                        </TableCell>
                                        <TableCell>{getLevelBadge(log.level)}</TableCell>
                                        <TableCell className="font-medium">{log.message}</TableCell>
                                        <TableCell className="text-xs text-muted-foreground">
                                            {log.shiftId && <div>Shift: {log.shiftId}</div>}
                                            {log.userId && <div>User: {log.userId}</div>}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </ScrollArea>
                )}
            </CardContent>
        </Card>
    )
}
