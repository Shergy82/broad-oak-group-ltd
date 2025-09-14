'use client';

import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { writeBatch, doc, Timestamp } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Spinner } from '@/components/shared/spinner';
import type { Shift } from '@/types';
import { format } from 'date-fns';
import { Check, CheckCheck, Gift } from 'lucide-react';

interface NewShiftsDialogProps {
  shifts: Shift[];
  onClose: () => void;
}

export function NewShiftsDialog({ shifts, onClose }: NewShiftsDialogProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleUpdate = async (shiftsToUpdate: Shift[], newStatus: 'confirmed' | 'rejected', notes?: string) => {
    if (!db) {
      toast({ variant: 'destructive', title: 'Database not configured' });
      return;
    }
    setIsLoading(true);

    try {
      const batch = writeBatch(db);
      const confirmedAt = newStatus === 'confirmed' ? Timestamp.now() : null;

      shiftsToUpdate.forEach(shift => {
        const shiftRef = doc(db, 'shifts', shift.id);
        const updatePayload: { status: 'confirmed' | 'rejected'; confirmedAt?: Timestamp | null; notes?: string } = { status: newStatus };
        if (confirmedAt) {
          updatePayload.confirmedAt = confirmedAt;
        }
        if (notes) {
          updatePayload.notes = notes;
        }
        batch.update(shiftRef, updatePayload as any);
      });

      await batch.commit();

      toast({
        title: `Shifts ${newStatus}`,
        description: `${shiftsToUpdate.length} shift(s) have been updated.`,
      });
      onClose();
    } catch (error: any) {
      console.error('Error updating shifts:', error);
      toast({
        variant: 'destructive',
        title: 'Update Failed',
        description: 'Could not update shifts. Please check your permissions and try again.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleAcceptAll = () => {
    handleUpdate(shifts, 'confirmed');
  };

  const handleAcceptSingle = (shift: Shift) => {
    handleUpdate([shift], 'confirmed');
  };

  const handleDialogClose = (open: boolean) => {
    if (!open) {
      setIsOpen(false);
      onClose();
    }
  };

  const getCorrectedLocalDate = (date: { toDate: () => Date }) => {
    const d = date.toDate();
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleDialogClose}>
      <DialogContent className="max-w-3xl" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gift className="text-primary h-6 w-6"/>
            You have {shifts.length} new shift(s) awaiting confirmation
          </DialogTitle>
          <DialogDescription>Please review and accept your newly assigned shifts below.</DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] my-4 rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[120px]">Date</TableHead>
                <TableHead>Task</TableHead>
                <TableHead>Address</TableHead>
                <TableHead className="text-right w-[120px]">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shifts.map(shift => (
                <TableRow key={shift.id}>
                  <TableCell className="font-medium">{format(getCorrectedLocalDate(shift.date), 'dd/MM/yy')}</TableCell>
                  <TableCell>{shift.task}</TableCell>
                  <TableCell>{shift.address}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleAcceptSingle(shift)}
                      disabled={isLoading}
                    >
                      <Check className="mr-2 h-4 w-4" /> Accept
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>

        <DialogFooter>
          <Button onClick={handleAcceptAll} disabled={isLoading} className="w-full sm:w-auto">
            {isLoading ? <Spinner /> : <><CheckCheck className="mr-2 h-4 w-4" /> Accept All ({shifts.length})</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
