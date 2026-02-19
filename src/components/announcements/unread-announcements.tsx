'use client';

import { useState } from 'react';
import type { User } from 'firebase/auth';
import { format } from 'date-fns';
import type { Announcement } from '@/types';
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
import { useToast } from '@/hooks/use-toast';
import { Spinner } from '@/components/shared/spinner';
import { Check, X } from 'lucide-react';
import { writeBatch, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';


interface UnreadAnnouncementsProps {
  announcements: Announcement[];
  user: User;
  onClose: () => void;
}

export function UnreadAnnouncements({ announcements, user, onClose }: UnreadAnnouncementsProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleAcknowledge = async () => {
    setIsLoading(true);
    try {
      if (!db) throw new Error("Database not ready");
      const batch = writeBatch(db);
      announcements.forEach(announcement => {
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
      
      toast({
        title: 'Announcements Acknowledged',
        description: 'You can now proceed to your dashboard.',
      });
      
      onClose();
    } catch (error: any) {
      console.error("Failed to acknowledge announcements:", error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Could not acknowledge announcements. Please try again.',
      });
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleDialogClose = (open: boolean) => {
      if (!open) {
          setIsOpen(false);
          onClose();
      }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleDialogClose}>
      <DialogContent className="max-w-lg" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>New Announcements</DialogTitle>
          <DialogDescription>
            Please review the following announcements before continuing to your dashboard.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] my-4 rounded-md border p-4">
          <div className="space-y-6">
            {announcements.map(announcement => (
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
          <Button type="button" variant="ghost" onClick={onClose}>
              <X className="mr-2 h-4 w-4" />
              Close
          </Button>
          <Button onClick={handleAcknowledge} disabled={isLoading} className="w-full sm:w-auto">
            {isLoading ? <Spinner /> : 
            <>
                <Check className="mr-2 h-4 w-4" />
                Acknowledge & Continue
            </>
            }
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
