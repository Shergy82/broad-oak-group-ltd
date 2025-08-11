
'use client';

import { useState } from 'react';
import type { User } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { writeBatch, doc, Timestamp } from 'firebase/firestore';
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
import { Check } from 'lucide-react';

interface UnreadAnnouncementsProps {
  announcements: Announcement[];
  user: User;
}

export function UnreadAnnouncements({ announcements, user }: UnreadAnnouncementsProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  const handleAcknowledge = async () => {
    if (!db) return;
    setIsLoading(true);

    try {
      const batch = writeBatch(db);
      const now = Timestamp.now();

      announcements.forEach(announcement => {
        const announcementRef = doc(db, 'announcements', announcement.id);
        const newViewEntry = `viewedBy.${user.uid}`;
        batch.update(announcementRef, { [newViewEntry]: now });
      });

      await batch.commit();
      
      toast({
        title: 'Announcements Acknowledged',
        description: 'You can now proceed to your dashboard.',
      });
      
      // Close the modal and refresh the dashboard page state
      setIsOpen(false); 
      // A soft navigation refresh to re-trigger the logic on the dashboard page
      router.replace('/dashboard'); 

    } catch (error) {
      console.error("Failed to mark announcements as viewed:", error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Could not save your acknowledgement. Please try again.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    // The Dialog is used here as a modal that overlays the entire screen
    <Dialog open={isOpen} onOpenChange={() => {}}>
      <DialogContent className="max-w-2xl" onInteractOutside={(e) => e.preventDefault()} hideCloseButton={true}>
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
                  Posted by {announcement.authorName} on {format(announcement.createdAt.toDate(), 'PPP')}
                </p>
                <p className="whitespace-pre-wrap text-sm">{announcement.content}</p>
              </div>
            ))}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button onClick={handleAcknowledge} disabled={isLoading} className="w-full">
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

declare module '@/components/ui/dialog' {
    interface DialogContentProps {
        hideCloseButton?: boolean;
    }
}
