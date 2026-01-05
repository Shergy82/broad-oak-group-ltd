
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
import { useUserProfile } from '@/hooks/use-user-profile';

interface UnreadAnnouncementsProps {
  announcements: Announcement[];
  user: User;
  onClose: () => void;
}

export function UnreadAnnouncements({ announcements, user, onClose }: UnreadAnnouncementsProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const { userProfile } = useUserProfile(); // Get the full user profile

  const handleAcknowledge = async () => {
    setIsLoading(true);
    try {
      // Get the list of announcements being displayed in the dialog.
      const newlyAcknowledgedIds = announcements.map(a => a.id);
      
      // Get the existing list of acknowledged IDs from local storage.
      const storedAcknowledged = localStorage.getItem(`acknowledgedAnnouncements_${user.uid}`);
      const acknowledgedIds = new Set(storedAcknowledged ? JSON.parse(storedAcknowledged) : []);

      // Add the new IDs to the set and save back to local storage.
      newlyAcknowledgedIds.forEach(id => acknowledgedIds.add(id));
      localStorage.setItem(`acknowledgedAnnouncements_${user.uid}`, JSON.stringify(Array.from(acknowledgedIds)));
      
      toast({
        title: 'Announcements Acknowledged',
        description: 'You can now proceed to your dashboard.',
      });
      
      onClose();
    } catch (error: any) {
      console.error("Failed to save acknowledgements to local storage:", error);
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
