
'use client';

import { useState } from 'react';
import { db } from '@/lib/firebase';
import { doc, writeBatch, serverTimestamp } from 'firebase/firestore';
import type { Shift, ShiftStatus } from '@/types';
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
import { Check, CheckCheck, ThumbsUp, ThumbsDown, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { Textarea } from '../ui/textarea';
import { Label } from '../ui/label';

interface RejectionDialogProps {
  shift: Shift;
  onClose: () => void;
  onConfirm: (shift: Shift, reason: string) => void;
}

function RejectionDialog({ shift, onClose, onConfirm }: RejectionDialogProps) {
    const [reason, setReason] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const { toast } = useToast();

    const handleConfirm = () => {
        if (!reason.trim()) {
            toast({ variant: 'destructive', title: 'Reason Required', description: 'Please explain why you are rejecting this shift.' });
            return;
        }
        setIsLoading(true);
        onConfirm(shift, reason.trim());
    }

    return (
        <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Reject Shift</DialogTitle>
                    <DialogDescription>
                        Please provide a reason for rejecting the shift: "{shift.task}" at {shift.address}.
                    </DialogDescription>
                </DialogHeader>
                <div className="py-4">
                    <Label htmlFor="rejection-reason">Reason</Label>
                    <Textarea
                        id="rejection-reason"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="e.g., Conflicting appointment, incorrect details..."
                        rows={4}
                    />
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={isLoading}>Cancel</Button>
                    <Button onClick={handleConfirm} disabled={isLoading} variant="destructive">
                        {isLoading ? <Spinner /> : 'Confirm Rejection'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

interface NewShiftsDialogProps {
  shifts: Shift[];
  onClose: () => void;
}

export function NewShiftsDialog({ shifts, onClose }: NewShiftsDialogProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [acknowledgedShifts, setAcknowledgedShifts] = useState<Record<string, ShiftStatus>>({});
  const [shiftToReject, setShiftToReject] = useState<Shift | null>(null);
  const { toast } = useToast();

  const handleUpdate = async (shiftsToUpdate: Shift[], newStatus: ShiftStatus, reason?: string) => {
    if (shiftsToUpdate.length === 0) return;
    setIsLoading(true);

    try {
      const batch = writeBatch(db);
      const shiftIds = shiftsToUpdate.map(s => s.id);
      
      const newProcessed: Record<string, ShiftStatus> = {};

      shiftIds.forEach(shiftId => {
        const shiftRef = doc(db, 'shifts', shiftId);
        const updateData: { status: ShiftStatus, isNew: boolean, notes?: string, confirmedAt?: any } = {
          status: newStatus,
          isNew: false, // Mark as not new anymore
        };
        
        if (newStatus === 'rejected' && reason) {
            updateData.notes = reason;
        }

        if (newStatus === 'confirmed') {
            updateData.confirmedAt = serverTimestamp();
        }

        batch.update(shiftRef, updateData);
        newProcessed[shiftId] = newStatus;
      });
      
      await batch.commit();

      setAcknowledgedShifts(prev => ({ ...prev, ...newProcessed }));
      
      toast({
        title: `Shift(s) Acknowledged`,
        description: `Your response has been recorded.`,
      });

      // Check if all shifts in the dialog have been processed
      const allShiftsInDialog = shifts.map(s => s.id);
      const processedIds = new Set([...Object.keys(acknowledgedShifts), ...shiftIds]);
      if (allShiftsInDialog.every(id => processedIds.has(id))) {
          setTimeout(() => onClose(), 800);
      }

    } catch (error: any) {
      console.error(`Failed to update shifts to ${newStatus}:`, error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Could not update shifts. Please try again.',
      });
    } finally {
      setIsLoading(false);
      setShiftToReject(null);
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

  const getCardClassName = (status?: ShiftStatus) => {
      if (status === 'confirmed') return 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800';
      if (status === 'rejected') return 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 opacity-70';
      return '';
  }

  const shiftsToProcess = shifts.filter(s => !acknowledgedShifts[s.id]);

  return (
    <>
    <Dialog open={isOpen} onOpenChange={handleDialogClose}>
      <DialogContent className="max-w-2xl" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>You Have New Shifts</DialogTitle>
          <DialogDescription>
            Please review and acknowledge your newly assigned shifts below.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] my-4 -mx-6 px-6">
          <div className="space-y-4 pr-1">
            {shifts.map(shift => {
              const status = acknowledgedShifts[shift.id];
              return (
                <Card key={shift.id} className={getCardClassName(status)}>
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
                    <CardContent className="flex justify-end items-center pt-0 gap-2">
                        {status === 'confirmed' && (
                            <div className="text-sm font-semibold text-green-600 flex items-center gap-2">
                                <CheckCheck className="h-4 w-4" /> Accepted
                            </div>
                        )}
                        {status === 'rejected' && (
                            <div className="text-sm font-semibold text-destructive flex items-center gap-2">
                                <X className="h-4 w-4" /> Rejected
                            </div>
                        )}
                        {!status && (
                          <>
                            <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => setShiftToReject(shift)}
                                disabled={isLoading}
                                className="h-8"
                            >
                                <ThumbsDown className="mr-2 h-4 w-4" /> Reject
                            </Button>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleUpdate([shift], 'confirmed')}
                                disabled={isLoading}
                                className="bg-primary text-primary-foreground hover:bg-primary/90 h-8"
                            >
                                <ThumbsUp className="mr-2 h-4 w-4" /> Accept
                            </Button>
                          </>
                        )}
                    </CardContent>
                </Card>
              )
            })}
          </div>
        </ScrollArea>

        <DialogFooter className="flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <Button 
                onClick={() => handleUpdate(shiftsToProcess, 'confirmed')} 
                disabled={isLoading || shiftsToProcess.length === 0}
                className="w-full sm:w-auto"
            >
                {isLoading ? <Spinner /> : 
                <>
                    <Check className="mr-2 h-4 w-4" />
                    Accept All Shifts
                </>
                }
            </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {shiftToReject && (
        <RejectionDialog
            shift={shiftToReject}
            onClose={() => setShiftToReject(null)}
            onConfirm={(shift, reason) => handleUpdate([shift], 'rejected', reason)}
        />
    )}
    </>
  );
}
