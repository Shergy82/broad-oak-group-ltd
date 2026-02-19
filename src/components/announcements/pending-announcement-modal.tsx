'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { format } from 'date-fns';
import { writeBatch, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Spinner } from '@/components/shared/spinner';
import { CheckCheck } from 'lucide-react';

export function PendingAnnouncementModal() {
  const { user, pendingAnnouncements, hasPendingAnnouncements } = useAuth();
  const [ackLoading, setAckLoading] = useState(false);

  // If no signed-in user or no pending announcement, don't render
  if (!user || !hasPendingAnnouncements) return null;

  async function handleAcknowledgeAll() {
    if (!user || pendingAnnouncements.length === 0) return;
    setAckLoading(true);
    try {
      if (!db) throw new Error("Database not initialized");
      const batch = writeBatch(db);
      pendingAnnouncements.forEach(announcement => {
        const id = `${announcement.id}_${user.uid}`;
        const ackRef = doc(db, 'announcementAcknowledgements', id);
        batch.set(ackRef, {
          announcementId: announcement.id,
          userId: user.uid,
          name: user.displayName ?? 'Unknown',
          acknowledgedAt: serverTimestamp(),
        });
      });
      await batch.commit();
      window.location.reload(); // Reload to allow AuthProvider to re-check
    } catch (e) {
      console.error("Failed to acknowledge announcements:", e);
      // Maybe show a toast here in a real app.
    } finally {
      setAckLoading(false);
    }
  }

  return (
    <Dialog open={true}>
      <DialogContent className="max-w-lg" onInteractOutside={(e) => e.preventDefault()} showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>New Announcements ({pendingAnnouncements.length})</DialogTitle>
          <DialogDescription>
            Please review the following announcements before continuing.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] my-4 rounded-md border p-4">
          <div className="space-y-6">
            {pendingAnnouncements.map(announcement => (
              <div key={announcement.id} className="p-4 rounded-lg bg-muted/50">
                <h3 className="font-semibold">{announcement.title}</h3>
                <p className="text-xs text-muted-foreground mb-2">
                  Posted by {announcement.authorName} on {announcement.createdAt?.toDate() ? format(announcement.createdAt.toDate(), 'PPP') : '...'}
                </p>
                <p className="whitespace-pre-wrap text-sm">{announcement.content}</p>
              </div>
            ))}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button onClick={handleAcknowledgeAll} disabled={ackLoading} className="w-full">
            {ackLoading ? <Spinner /> : 
            <>
              <CheckCheck className="mr-2 h-4 w-4" />
              Acknowledge All & Continue
            </>
            }
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
