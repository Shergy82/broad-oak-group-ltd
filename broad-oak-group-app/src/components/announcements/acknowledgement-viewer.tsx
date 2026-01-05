'use client';

import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { format } from 'date-fns';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import type { Announcement, Acknowledgement } from '@/types';
import { Users } from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';

interface AcknowledgementViewerProps {
  announcement: Announcement | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AcknowledgementViewer({ announcement, open, onOpenChange }: AcknowledgementViewerProps) {
  const [acknowledgements, setAcknowledgements] = useState<Acknowledgement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!announcement || !open) {
      return;
    }
    setLoading(true);

    const acknowledgementsQuery = query(
      collection(db, `announcements/${announcement.id}/acknowledgedBy`),
      orderBy('acknowledgedAt', 'desc')
    );

    const unsubscribe = onSnapshot(acknowledgementsQuery, (snapshot) => {
      const fetchedAcks = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      } as Acknowledgement));
      setAcknowledgements(fetchedAcks);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching acknowledgements:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [announcement, open]);

  if (!announcement) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Viewed By</DialogTitle>
          <DialogDescription>
            This is a list of users who have acknowledged the announcement: "{announcement.title}".
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4">
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : acknowledgements.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
              <Users className="mx-auto h-12 w-12 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-semibold">No One Yet</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                No users have acknowledged this announcement.
              </p>
            </div>
          ) : (
            <ScrollArea className="h-72 w-full rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead className="text-right">Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {acknowledgements.map(ack => (
                    <TableRow key={ack.id}>
                      <TableCell className="font-medium">{ack.userName}</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {format(ack.acknowledgedAt.toDate(), 'dd MMM, p')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
