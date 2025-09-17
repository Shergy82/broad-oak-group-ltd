
'use client';

import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { writeBatch, doc } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Spinner } from '@/components/shared/spinner';
import type { Shift } from '@/types';
import { format } from 'date-fns';
import { CheckCheck, Gift } from 'lucide-react';
import { Card, CardContent, CardDescription } from '../ui/card';

interface NewShiftsDialogProps {
  shifts: Shift[];
  onClose: () => void;
}

export function NewShiftsDialog({ shifts, onClose }: NewShiftsDialogProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleUpdate = async (shiftsToUpdate: Shift[]) => {
    if (!db) {
      toast({ variant: 'destructive', title: 'Database not configured' });
      return;
    }
    setIsLoading(true);

    try {
      const batch = writeBatch(db);
      
      shiftsToUpdate.forEach(shift => {
        const shiftRef = doc(db, 'shifts', shift.id);
        batch.update(shiftRef, { status: 'confirmed' });
      });

      await batch.commit();

      toast({
        title: `Shifts Confirmed`,
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
    handleUpdate(shifts);
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
      <DialogContent className="max-w-2xl" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gift className="text-primary h-6 w-6"/>
            You have {shifts.length} new shift(s) awaiting confirmation
          </DialogTitle>
          <DialogDescription>Please review and accept your newly assigned shifts below.</DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] my-4">
          {/* Desktop Table View */}
          <div className="hidden sm:block rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[120px]">Date</TableHead>
                  <TableHead>Task</TableHead>
                  <TableHead>Address</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shifts.map(shift => (
                  <TableRow key={shift.id}>
                    <TableCell className="font-medium">{format(getCorrectedLocalDate(shift.date), 'dd/MM/yy')}</TableCell>
                    <TableCell>{shift.task}</TableCell>
                    <TableCell>{shift.address}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {/* Mobile Card View */}
          <div className="space-y-4 sm:hidden">
              {shifts.map(shift => (
                <Card key={shift.id} className="shadow-sm">
                    <CardContent className="p-4 space-y-1">
                      <p className="font-bold">{shift.task}</p>
                      <CardDescription>{shift.address}</CardDescription>
                      <CardDescription>Date: {format(getCorrectedLocalDate(shift.date), 'EEE, dd MMM yyyy')}</CardDescription>
                    </CardContent>
                </Card>
              ))}
          </div>
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
