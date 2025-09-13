
'use client';

import { useState } from 'react';
import { db } from '@/lib/firebase';
import { doc, writeBatch, serverTimestamp } from 'firebase/firestore';
import type { Shift } from '@/types';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';

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
import { Spinner } from '@/components/shared/spinner';
import { Check, CheckCheck, ThumbsUp, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';

interface NewShiftsDialogProps {
  shifts: Shift[];
  onClose: () => void;
}

export function NewShiftsDialog({ shifts, onClose }: NewShiftsDialogProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [acceptedShifts, setAcceptedShifts] = useState<string[]>([]);
  const { toast } = useToast();

  const handleUpdate = async (shiftsToUpdate: Shift[]) => {
    if (shiftsToUpdate.length === 0) return;
    setIsLoading(true);

    try {
      const batch = writeBatch(db);
      const shiftIds = shiftsToUpdate.map(s => s.id);
      
      shiftIds.forEach(shiftId => {
        const shiftRef = doc(db, 'shifts', shiftId);
        batch.update(shiftRef, { status: 'confirmed', confirmedAt: serverTimestamp() });
      });
      
      await batch.commit();

      setAcceptedShifts(prev => [...prev, ...shiftIds]);
      
      toast({
        title: `${shiftsToUpdate.length} shift(s) accepted`,
        description: "Your schedule has been updated.",
      });

      if (shifts.length === acceptedShifts.length + shiftsToUpdate.length) {
          setTimeout(() => onClose(), 800);
      }

    } catch (error: any) {
      console.error("Failed to accept shifts:", error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Could not accept shifts. Please try again.',
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
  };

  const d = (date: { toDate: () => Date }) => {
    const d = date.toDate();
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleDialogClose}>
      <DialogContent className="max-w-2xl" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>You Have New Shifts</DialogTitle>
          <DialogDescription>
            Please review and accept your newly assigned shifts below.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] my-4 -mx-6 px-6">
          <div className="space-y-4 pr-1">
            {shifts.map(shift => {
              const isAccepted = acceptedShifts.includes(shift.id);
              return (
                <Card key={shift.id} className={isAccepted ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' : ''}>
                    <CardHeader className="flex flex-row items-start justify-between pb-3">
                       <div>
                           <CardTitle className="text-base">{shift.task}</CardTitle>
                           <CardDescription>{shift.address}</CardDescription>
                       </div>
                        <div className="text-sm text-muted-foreground whitespace-nowrap">
                            {format(d(shift.date), 'EEE, MMM d')}
                            <span className="ml-2 capitalize rounded-md bg-muted px-2 py-1 text-xs font-medium">
                                {shift.type === 'all-day' ? 'All Day' : shift.type}
                            </span>
                        </div>
                    </CardHeader>
                    <CardContent className="flex justify-end pt-0">
                        {isAccepted ? (
                            <div className="text-sm font-semibold text-green-600 flex items-center gap-2">
                                <CheckCheck className="h-4 w-4" /> Accepted
                            </div>
                        ) : (
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleUpdate([shift])}
                                disabled={isLoading}
                                className="bg-accent text-accent-foreground hover:bg-accent/90"
                            >
                                <ThumbsUp className="mr-2 h-4 w-4" /> Accept Shift
                            </Button>
                        )}
                    </CardContent>
                </Card>
              )
            })}
          </div>
        </ScrollArea>

        <DialogFooter className="flex-col-reverse sm:flex-row sm:justify-between gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={isLoading}>
              <X className="mr-2 h-4 w-4" />
              Do It Later
            </Button>
            <Button 
                onClick={() => handleUpdate(shifts.filter(s => !acceptedShifts.includes(s.id)))} 
                disabled={isLoading || shifts.length === acceptedShifts.length}
                className="w-full sm:w-auto"
            >
                {isLoading ? <Spinner /> : 
                <>
                    <Check className="mr-2 h-4 w-4" />
                    Accept All Remaining
                </>
                }
            </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
