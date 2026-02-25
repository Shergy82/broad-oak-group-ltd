
'use client';

import { useState, useMemo } from 'react';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { writeBatch, doc, serverTimestamp } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Spinner } from '@/components/shared/spinner';
import type { Shift } from '@/types';
import { format } from 'date-fns';
import { CheckCheck, Gift, ThumbsDown, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

interface NewShiftsDialogProps {
  shifts: Shift[];
  onClose: () => void;
}

export function NewShiftsDialog({ shifts, onClose }: NewShiftsDialogProps) {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedShiftIds, setSelectedShiftIds] = useState<Set<string>>(new Set());
  const [isRejectDialogOpen, setIsRejectDialogOpen] = useState(false);
  const [rejectionNote, setRejectionNote] = useState('');
  const { toast } = useToast();

  const getCorrectedLocalDate = (date: { toDate: () => Date }) => {
    const d = date.toDate();
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  };

  const sortedShifts = useMemo(() => {
    return [...shifts].sort((a, b) => getCorrectedLocalDate(a.date).getTime() - getCorrectedLocalDate(b.date).getTime());
  }, [shifts]);

  const handleUpdate = async (shiftsToUpdate: Shift[], newStatus: 'confirmed' | 'rejected', notes?: string) => {
    if (!db || !user) {
      toast({ variant: 'destructive', title: 'Error', description: 'Could not update shifts. User or database not available.' });
      return;
    }
    setIsLoading(true);

    try {
      const batch = writeBatch(db);
      shiftsToUpdate.forEach(shift => {
        const shiftRef = doc(db, 'shifts', shift.id);
        const updateData: any = {
          status: newStatus,
          updatedByUid: user.uid,
          updatedByAction: newStatus,
          updatedAt: serverTimestamp()
        };
        if (notes) {
          updateData.notes = notes;
        }
        batch.update(shiftRef, updateData);
      });

      await batch.commit();

      toast({
        title: `Shifts ${newStatus === 'confirmed' ? 'Confirmed' : 'Rejected'}`,
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
      setIsRejectDialogOpen(false);
      setRejectionNote('');
    }
  };

  const handleToggleAll = () => {
    if (selectedShiftIds.size === sortedShifts.length) {
      setSelectedShiftIds(new Set());
    } else {
      setSelectedShiftIds(new Set(sortedShifts.map(s => s.id)));
    }
  };

  const handleToggleRow = (shiftId: string) => {
    const newSelection = new Set(selectedShiftIds);
    if (newSelection.has(shiftId)) {
      newSelection.delete(shiftId);
    } else {
      newSelection.add(shiftId);
    }
    setSelectedShiftIds(newSelection);
  };

  const getSelectedShifts = () => {
    return sortedShifts.filter(s => selectedShiftIds.has(s.id));
  };

  const handleAcceptSelected = () => {
    const selected = getSelectedShifts();
    if (selected.length === 0) {
      toast({ title: 'No shifts selected', description: 'Please select one or more shifts to accept.' });
      return;
    }
    handleUpdate(selected, 'confirmed');
  };

  const handleAcceptAll = () => {
    handleUpdate(sortedShifts, 'confirmed');
  };

  const handleRejectSelected = () => {
    if (getSelectedShifts().length === 0) {
      toast({ title: 'No shifts selected', description: 'Please select one or more shifts to reject.' });
      return;
    }
    setIsRejectDialogOpen(true);
  };

  const handleConfirmRejection = () => {
    if (!rejectionNote.trim()) {
        toast({ variant: 'destructive', title: 'Reason Required', description: 'Please provide a reason for rejecting the shift(s).'});
        return;
    }
    const selected = getSelectedShifts();
    handleUpdate(selected, 'rejected', rejectionNote);
  };

  return (
    <>
      <Dialog open={isOpen}>
        <DialogContent showCloseButton={false} className="max-w-3xl" onInteractOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Gift className="text-primary h-6 w-6" />
              You have {shifts.length} new shift(s) awaiting confirmation
            </DialogTitle>
            <DialogDescription>Please review and accept or reject your newly assigned shifts below.</DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[60vh] my-4">
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12 px-4">
                      <Checkbox
                        checked={selectedShiftIds.size > 0 && selectedShiftIds.size === sortedShifts.length}
                        onCheckedChange={handleToggleAll}
                        aria-label="Select all"
                      />
                    </TableHead>
                    <TableHead className="w-[120px]">Date</TableHead>
                    <TableHead>Task</TableHead>
                    <TableHead>Address</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedShifts.map(shift => (
                    <TableRow key={shift.id} data-state={selectedShiftIds.has(shift.id) && "selected"}>
                      <TableCell className="px-4">
                         <Checkbox
                            checked={selectedShiftIds.has(shift.id)}
                            onCheckedChange={() => handleToggleRow(shift.id)}
                            aria-label={`Select shift ${shift.id}`}
                          />
                      </TableCell>
                      <TableCell className="font-medium">{format(getCorrectedLocalDate(shift.date), 'dd/MM/yy')}</TableCell>
                      <TableCell>{shift.task}</TableCell>
                      <TableCell>{shift.address}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </ScrollArea>

          <DialogFooter className="flex-col sm:flex-row sm:justify-between gap-2">
            <Button variant="destructive" onClick={handleRejectSelected} disabled={isLoading || selectedShiftIds.size === 0}>
                {isLoading ? <Spinner /> : <><ThumbsDown className="mr-2 h-4 w-4" /> Reject Selected</>}
            </Button>
            <div className="flex flex-col sm:flex-row gap-2">
              <Button variant="outline" onClick={handleAcceptSelected} disabled={isLoading || selectedShiftIds.size === 0}>
                {isLoading ? <Spinner /> : <>Accept Selected ({selectedShiftIds.size})</>}
              </Button>
              <Button onClick={handleAcceptAll} disabled={isLoading}>
                {isLoading ? <Spinner /> : <><CheckCheck className="mr-2 h-4 w-4" /> Accept All ({shifts.length})</>}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <Dialog open={isRejectDialogOpen} onOpenChange={setIsRejectDialogOpen}>
        <DialogContent>
            <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                    <AlertTriangle className="text-destructive h-5 w-5"/>
                    Reason for Rejection
                </DialogTitle>
                <DialogDescription>
                    Please provide a brief reason why you are rejecting the selected {getSelectedShifts().length} shift(s). This will be sent to your manager.
                </DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-2">
                <Label htmlFor="rejection-note">Reason</Label>
                <Textarea 
                    id="rejection-note"
                    value={rejectionNote}
                    onChange={(e) => setRejectionNote(e.target.value)}
                    placeholder="e.g., Cannot make this date, already booked, etc."
                />
            </div>
            <DialogFooter>
                <Button variant="outline" onClick={() => setIsRejectDialogOpen(false)}>Cancel</Button>
                <Button variant="destructive" onClick={handleConfirmRejection} disabled={isLoading}>
                    {isLoading ? <Spinner /> : "Confirm Rejection"}
                </Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
