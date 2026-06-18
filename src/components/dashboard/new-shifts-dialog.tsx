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
import { CheckCircle2, ThumbsDown, AlertTriangle, Gift } from 'lucide-react';
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
    if (!db || !user) return;
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
        if (notes) updateData.notes = notes;
        batch.update(shiftRef, updateData);
      });

      await batch.commit();
      toast({ title: `Shifts ${newStatus === 'confirmed' ? 'Confirmed' : 'Rejected'}`, description: `${shiftsToUpdate.length} shift(s) updated.` });
      onClose();
    } catch (error) {
      console.error('Error updating shifts:', error);
      toast({ variant: 'destructive', title: 'Update Failed' });
    } finally {
      setIsLoading(false);
      setIsRejectDialogOpen(false);
    }
  };

  const handleToggleAll = () => {
    if (selectedShiftIds.size === sortedShifts.length) setSelectedShiftIds(new Set());
    else setSelectedShiftIds(new Set(sortedShifts.map(s => s.id)));
  };

  const handleToggleRow = (shiftId: string) => {
    const next = new Set(selectedShiftIds);
    if (next.has(shiftId)) next.delete(shiftId);
    else next.add(shiftId);
    setSelectedShiftIds(next);
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
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] my-4">
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12 px-4">
                      <Checkbox checked={selectedShiftIds.size > 0 && selectedShiftIds.size === sortedShifts.length} onCheckedChange={handleToggleAll} />
                    </TableHead>
                    <TableHead>Date</TableHead><TableHead>Task</TableHead><TableHead>Address</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedShifts.map(shift => (
                    <TableRow key={shift.id}>
                      <TableCell className="px-4"><Checkbox checked={selectedShiftIds.has(shift.id)} onCheckedChange={() => handleToggleRow(shift.id)} /></TableCell>
                      <TableCell>{format(getCorrectedLocalDate(shift.date), 'dd/MM/yy')}</TableCell>
                      <TableCell>{shift.task}</TableCell><TableCell>{shift.address}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </ScrollArea>
          <DialogFooter className="sm:justify-between gap-2">
            <Button variant="destructive" onClick={() => setIsRejectDialogOpen(true)} disabled={isLoading || selectedShiftIds.size === 0}><ThumbsDown className="mr-2 h-4 w-4" /> Reject</Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => handleUpdate(sortedShifts.filter(s => selectedShiftIds.has(s.id)), 'confirmed')} disabled={isLoading || selectedShiftIds.size === 0}>Accept Selected</Button>
              <Button onClick={() => handleUpdate(sortedShifts, 'confirmed')} disabled={isLoading}><CheckCircle2 className="mr-2 h-4 w-4" /> Accept All ({shifts.length})</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={isRejectDialogOpen} onOpenChange={setIsRejectDialogOpen}>
        <DialogContent>
            <DialogHeader><DialogTitle>Reason for Rejection</DialogTitle></DialogHeader>
            <div className="py-4 space-y-2"><Label>Reason</Label><Textarea value={rejectionNote} onChange={e => setRejectionNote(e.target.value)} placeholder="e.g., Cannot make this date" /></div>
            <DialogFooter><Button variant="outline" onClick={() => setIsRejectDialogOpen(false)}>Cancel</Button><Button variant="destructive" onClick={() => handleUpdate(sortedShifts.filter(s => selectedShiftIds.has(s.id)), 'rejected', rejectionNote)} disabled={isLoading || !rejectionNote.trim()}>Confirm Rejection</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
