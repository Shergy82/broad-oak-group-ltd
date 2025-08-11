'use client';

import { useState } from 'react';
import type { User } from 'firebase/auth';
import { format } from 'date-fns';
import { doc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
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
      if (!db) {
          throw new Error("Firestore is not available.");
      }

      // 1. Use local storage to immediately hide the dialog
      const acknowledgedIds = announcements.map(a => a.id);
      localStorage.setItem(`acknowledgedAnnouncements_${user.uid}`, JSON.stringify(acknowledgedIds));
      
      // 2. Write acknowledgement to Firestore for admin viewing
      const batch = writeBatch(db);
      announcements.forEach((announcement) => {
        const ackRef = doc(db, `announcements/${announcement.id}/acknowledgedBy`, user.uid);
        batch.set(ackRef, { 
            acknowledgedAt: serverTimestamp(),
            userName: user.displayName || 'Unknown User'
        });
      });
      await batch.commit();

      toast({
        title: 'Announcements Acknowledged',
        description: 'You can now proceed to your dashboard.',
      });
      
      onClose();
    } catch (error: any) {
      console.error("Failed to save acknowledgements:", error);
      // Even if Firestore fails, we proceed because local storage succeeded.
      // This ensures the user is not blocked.
      toast({
        variant: 'destructive',
        title: 'Error Syncing',
        description: 'Could not save your acknowledgement to the server, but you can continue.',
      });
      onClose();
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
      <DialogContent className="max-w-2xl" onInteractOutside={(e) => e.preventDefault()}>
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
