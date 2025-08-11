
'use client';

import { useState } from 'react';
import type { User } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { functions, httpsCallable } from '@/lib/firebase';
import type { Announcement } from '@/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { Spinner } from '@/components/shared/spinner';
import { Check } from 'lucide-react';

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
    if (!functions) {
        toast({ variant: 'destructive', title: 'Error', description: 'Functions service not available.' });
        return;
    }
    setIsLoading(true);

    try {
      const acknowledgeFn = httpsCallable(functions, 'acknowledgeAnnouncement');
      const announcementIds = announcements.map(a => a.id);
      await acknowledgeFn({ announcementIds });
      
      toast({
        title: 'Announcements Acknowledged',
        description: 'You can now proceed to your dashboard.',
      });
      
      onClose();
    } catch (error: any) {
      console.error("Failed to mark announcements as viewed:", error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'Could not save your acknowledgement. Please try again.',
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
    // The Dialog is used here as a modal that overlays the entire screen
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
          <DialogClose asChild>
            <Button type="button" variant="secondary">
                Close
            </Button>
          </DialogClose>
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
