
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { doc, updateDoc, deleteField, collection, query, where, getDocs } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '@/lib/firebase';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Clock, Sunrise, Sunset, ThumbsUp, CheckCircle2, XCircle, AlertTriangle, RotateCcw, Trash2, HardHat, ListChecks, Camera } from 'lucide-react';
import { Spinner } from '@/components/shared/spinner';
import type { Shift, ShiftStatus, UserProfile, TradeTask, Trade } from '@/types';
import { useAuth } from '@/hooks/use-auth';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '../ui/alert-dialog';
import { Checkbox } from '../ui/checkbox';


interface ShiftCardProps {
  shift: Shift;
  userProfile: UserProfile | null;
  onDismiss?: (shiftId: string) => void;
}

const shiftTypeDetails = {
  am: { icon: Sunrise, label: 'AM Shift', color: 'bg-sky-500' },
  pm: { icon: Sunset, label: 'PM Shift', color: 'bg-orange-500' },
  'all-day': { icon: Clock, label: 'All Day', color: 'bg-indigo-500' },
};

const statusDetails: { [key in ShiftStatus]: { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; className: string; icon: React.ElementType } } = {
  'pending-confirmation': { label: 'Pending', variant: 'secondary', className: '', icon: AlertTriangle },
  confirmed: { label: 'Confirmed', variant: 'default', className: 'bg-primary hover:bg-primary/90', icon: ThumbsUp },
  'on-site': { label: 'On Site', variant: 'default', className: 'bg-teal-500 hover:bg-teal-600', icon: HardHat },
  completed: { label: 'Completed', variant: 'default', className: 'bg-green-600 hover:bg-green-700', icon: CheckCircle2 },
  incomplete: { label: 'Incomplete', variant: 'destructive', className: 'bg-amber-600 hover:bg-amber-700 text-white border-amber-600', icon: XCircle },
  rejected: { label: 'Rejected', variant: 'destructive', className: 'bg-destructive/80 hover:bg-destructive/90 text-white border-destructive/80', icon: XCircle },
};

const LS_SHIFT_TASKS_KEY = 'shiftTaskCompletion';

export function ShiftCard({ shift, userProfile, onDismiss }: ShiftCardProps) {
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [isNoteDialogOpen, setIsNoteDialogOpen] = useState(false);
  const [note, setNote] = useState('');

  const [tradeTasks, setTradeTasks] = useState<TradeTask[]>([]);
  const [completedTasks, setCompletedTasks] = useState<Set<number>>(new Set());

  const d = shift.date.toDate();
  const shiftDate = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

  const ShiftIcon = shiftTypeDetails[shift.type].icon;
  const statusInfo = statusDetails[shift.status];
  const StatusIcon = statusInfo.icon;
  
  const isHistorical = shift.status === 'completed' || shift.status === 'incomplete';
  const allTasksCompleted = tradeTasks.length === 0 || completedTasks.size === tradeTasks.length;

  useEffect(() => {
    async function fetchTradeTasks() {
      if (userProfile?.trade && db) {
        try {
          const q = query(collection(db, 'trade_tasks'), where('name', '==', userProfile.trade));
          const querySnapshot = await getDocs(q);
          if (!querySnapshot.empty) {
            const tradeData = querySnapshot.docs[0].data() as Trade;
            setTradeTasks(tradeData.tasks || []);
          } else {
            setTradeTasks([]);
          }
        } catch (e) {
          console.error("Failed to load trade tasks from Firestore", e);
        }
      }
    }
    fetchTradeTasks();
  }, [userProfile?.trade]);

  useEffect(() => {
    if (tradeTasks.length > 0) {
      try {
        const allShiftTasks = JSON.parse(localStorage.getItem(LS_SHIFT_TASKS_KEY) || '{}');
        const shiftCompletedTasks = allShiftTasks[shift.id];
        if (shiftCompletedTasks) {
          setCompletedTasks(new Set(shiftCompletedTasks));
        } else {
          setCompletedTasks(new Set());
        }
      } catch (e) {
        console.error("Failed to load shift task completion state", e);
        setCompletedTasks(new Set());
      }
    }
  }, [shift.id, tradeTasks.length]);

  const handleTaskToggle = (taskIndex: number) => {
    const newCompletedTasks = new Set(completedTasks);
    if (newCompletedTasks.has(taskIndex)) {
      newCompletedTasks.delete(taskIndex);
    } else {
      newCompletedTasks.add(taskIndex);
    }
    setCompletedTasks(newCompletedTasks);

    try {
        const allShiftTasks = JSON.parse(localStorage.getItem(LS_SHIFT_TASKS_KEY) || '{}');
        allShiftTasks[shift.id] = Array.from(newCompletedTasks);
        localStorage.setItem(LS_SHIFT_TASKS_KEY, JSON.stringify(allShiftTasks));
    } catch (e) {
      console.error("Failed to save shift task completion state", e);
    }
  };


  const handleUpdateStatus = async (newStatus: ShiftStatus, notes?: string) => {
    if (!isFirebaseConfigured || !db || !user) {
      toast({
        variant: 'destructive',
        title: 'Authentication Error',
        description: 'You must be logged in to update shifts.',
      });
      return;
    }

    setIsLoading(true);
    try {
      const shiftRef = doc(db, 'shifts', shift.id);
      
      const updateData: { status: ShiftStatus; notes?: any } = { status: newStatus };
      if (notes) {
        updateData.notes = notes;
      } else if (newStatus === 'confirmed') {
        updateData.notes = deleteField();
      }
      
      await updateDoc(shiftRef, updateData as any);

      toast({
        title: `Shift status updated`,
        description: `Shift is now marked as ${newStatus}.`,
      });
      router.refresh(); 
    } catch (error: any) {
      let description = 'Could not update shift status.';
      if (error.code === 'permission-denied') {
        description = "You don't have permission to update this shift.";
      }
      toast({
        variant: 'destructive',
        title: 'Update Failed',
        description,
      });
    } finally {
      setIsLoading(false);
      setIsNoteDialogOpen(false);
      setNote('');
    }
  };
  
  const handleIncompleteSubmit = () => {
      if (!note.trim()) {
          toast({ variant: 'destructive', title: 'Note Required', description: 'Please provide a note explaining why the shift is incomplete.' });
          return;
      }
      handleUpdateStatus('incomplete', note.trim());
  }

  const renderTaskList = () => {
    if (shift.status !== 'on-site') return null;

    return (
      <div className="mt-4 p-4 border-t">
        <h4 className="font-semibold text-sm mb-3 flex items-center gap-2 text-muted-foreground"><ListChecks/> Checklist</h4>
        <div className="space-y-3">
          {tradeTasks.map((task, index) => (
            <div key={index} className="flex items-center space-x-3">
              <Checkbox
                id={`task-${shift.id}-${index}`}
                checked={completedTasks.has(index)}
                onCheckedChange={() => handleTaskToggle(index)}
                disabled={isLoading}
              />
              <Label htmlFor={`task-${shift.id}-${index}`} className="text-sm font-normal text-foreground flex-grow cursor-pointer">
                {task.text}
              </Label>
              {task.photoRequired && <Camera className="h-4 w-4 text-muted-foreground" />}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      <Card className="flex flex-col overflow-hidden transition-all hover:shadow-xl border-border hover:border-primary/40">
        <CardHeader className="flex flex-row items-start justify-between space-y-0 bg-card p-4">
          <div className="flex items-center gap-3">
            <div className={`flex items-center justify-center rounded-lg w-12 h-12 ${shiftTypeDetails[shift.type].color}`}>
              <ShiftIcon className="h-6 w-6 text-white" />
            </div>
            <div>
              <CardTitle className="text-md font-bold">{shiftTypeDetails[shift.type].label}</CardTitle>
              <p className="text-sm text-muted-foreground">{format(shiftDate, 'eeee, MMM d')}</p>
            </div>
          </div>
          <Badge variant={statusInfo.variant} className={`${statusInfo.className} shrink-0`}>
            <StatusIcon className="mr-1.5 h-3 w-3" />
            {statusInfo.label}
          </Badge>
        </CardHeader>
        <CardContent className="p-4 text-left grow flex flex-col justify-center space-y-1">
          <p className="font-semibold text-sm">{shift.task}</p>
          <p className="text-xs text-muted-foreground">{shift.address}</p>
          {shift.bNumber && <p className="text-xs text-muted-foreground">B-Number: {shift.bNumber}</p>}
          {shift.manager && <p className="text-xs text-muted-foreground">Manager: {shift.manager}</p>}
          {(shift.status === 'incomplete' || shift.status === 'rejected') && shift.notes && (
            <div className="mt-3 p-3 bg-destructive/10 border-l-4 border-destructive rounded-r-md">
                <p className="text-sm font-semibold text-destructive">Note:</p>
                <p className="text-sm text-destructive/90 italic">"{shift.notes}"</p>
            </div>
          )}
        </CardContent>
        {renderTaskList()}
        <CardFooter className="p-2 bg-muted/30 grid grid-cols-1 gap-2">
          {shift.status === 'pending-confirmation' && (
            <Button onClick={() => handleUpdateStatus('confirmed')} className="w-full bg-accent text-accent-foreground hover:bg-accent/90" disabled={isLoading}>
              {isLoading ? <Spinner /> : <><ThumbsUp className="mr-2 h-4 w-4" /> Accept Shift</>}
            </Button>
          )}

          {shift.status === 'confirmed' && (
             <Button onClick={() => handleUpdateStatus('on-site')} className="w-full bg-teal-500 text-white hover:bg-teal-600" disabled={isLoading}>
                {isLoading ? <Spinner /> : <><HardHat className="mr-2 h-4 w-4" /> On Site</>}
            </Button>
          )}

          {shift.status === 'on-site' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                 <Button onClick={() => handleUpdateStatus('completed')} className="w-full bg-green-500 text-white hover:bg-green-600" disabled={isLoading || !allTasksCompleted}>
                    {isLoading ? <Spinner /> : <><CheckCircle2 className="mr-2 h-4 w-4" /> Complete</>}
                </Button>
                 <Button variant="destructive" onClick={() => setIsNoteDialogOpen(true)} className="w-full bg-amber-600 hover:bg-amber-700" disabled={isLoading}>
                    {isLoading ? <Spinner /> : <><XCircle className="mr-2 h-4 w-4" /> Incomplete</>}
                </Button>
            </div>
          )}

          {isHistorical && (
            <div className="grid grid-cols-2 gap-2">
                 <Button variant="outline" onClick={() => handleUpdateStatus('confirmed')} className="w-full" disabled={isLoading}>
                   {isLoading ? <Spinner /> : <><RotateCcw className="mr-2 h-4 w-4" /> Re-open</>}
                </Button>
                {onDismiss && (
                   <AlertDialog>
                        <AlertDialogTrigger asChild>
                           <Button variant="destructive" className="w-full" disabled={isLoading}>
                                <Trash2 className="mr-2 h-4 w-4" /> Dismiss
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Dismiss Shift?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    This will hide the shift from your view. It will not be deleted. Are you sure?
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => onDismiss(shift.id)}>Dismiss</AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                )}
            </div>
          )}
        </CardFooter>
      </Card>
      
      <Dialog open={isNoteDialogOpen} onOpenChange={setIsNoteDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Mark Shift as Incomplete</DialogTitle>
            <DialogDescription>
              Please provide a reason why this shift could not be completed. This note will be visible to admins.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid w-full gap-1.5">
              <Label htmlFor="note">Note</Label>
              <Textarea 
                placeholder="e.g., waiting for materials, client not home, etc." 
                id="note" 
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsNoteDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleIncompleteSubmit} disabled={isLoading} className="bg-amber-600 hover:bg-amber-700">
                {isLoading ? <Spinner /> : 'Submit Note'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
