
'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import {
  doc,
  updateDoc,
  deleteField,
  collection,
  query,
  where,
  getDocs,
  addDoc,
  serverTimestamp,
  onSnapshot,
  deleteDoc,
  Timestamp,
  orderBy,
} from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { db, isFirebaseConfigured, storage } from '@/lib/firebase';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import {
  Clock,
  Sunrise,
  Sunset,
  ThumbsUp,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RotateCcw,
  Trash2,
  HardHat,
  ListChecks,
  Camera,
  Undo,
  MapPin,
  Coins,
  Plus,
} from 'lucide-react';
import { Spinner } from '@/components/shared/spinner';
import type { Shift, ShiftStatus, UserProfile, TradeTask, Trade, MaterialPurchase } from '@/types';
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../ui/alert-dialog';
import { Checkbox } from '../ui/checkbox';
import { MultiPhotoCamera } from '../shared/multi-photo-camera';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { Input } from '../ui/input';
import { Table, TableBody, TableCell, TableHeader, TableRow } from '../ui/table';

interface PurchaseLogDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: () => void;
    mode: 'query' | 'add';
    shiftId: string;
    userProfile: UserProfile | null;
}

function PurchaseLogDialog({ open, onOpenChange, onConfirm, mode, shiftId, userProfile }: PurchaseLogDialogProps) {
  const [didBuy, setDidBuy] = useState<'no' | 'yes'>(mode === 'add' ? 'yes' : 'no');
  const [purchases, setPurchases] = useState<MaterialPurchase[]>([]);
  const [supplier, setSupplier] = useState('');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      setDidBuy(mode === 'add' ? 'yes' : 'no');
      setSupplier('');
      setAmount('');
    }
  }, [open, mode]);

  useEffect(() => {
    if (!open || !shiftId) return;

    setLoading(true);
    const purchasesQuery = query(collection(db, `shifts/${shiftId}/materialPurchases`));
    const unsubscribe = onSnapshot(purchasesQuery, (snapshot) => {
        const fetchedPurchases = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as MaterialPurchase));
        setPurchases(fetchedPurchases);
        if (mode === 'query' && fetchedPurchases.length > 0) {
            setDidBuy('yes');
        }
        setLoading(false);
    });

    return () => unsubscribe();
  }, [open, shiftId, mode]);


  const handleAddPurchase = async (): Promise<boolean> => {
    if (!supplier.trim() || !amount.trim() || !userProfile) {
        toast({ variant: 'destructive', title: "Missing Information", description: "Please enter supplier and amount." });
        return false;
    }
    try {
        await addDoc(collection(db, `shifts/${shiftId}/materialPurchases`), {
            shiftId,
            userId: userProfile.uid,
            userName: userProfile.name,
            supplier: supplier.trim(),
            amount: parseFloat(amount),
            purchasedAt: serverTimestamp(),
        });
        toast({ title: 'Purchase Added' });
        setSupplier('');
        setAmount('');
        return true;
    } catch (e) {
        console.error("Error adding purchase:", e);
        toast({ variant: 'destructive', title: "Error", description: "Could not log purchase." });
        return false;
    }
  };

  const handleDeletePurchase = async (id: string) => {
    try {
        await deleteDoc(doc(db, `shifts/${shiftId}/materialPurchases`, id));
        toast({ title: 'Purchase Removed' });
    } catch(e) {
        console.error("Error deleting purchase:", e);
        toast({ variant: 'destructive', title: "Error", description: "Could not remove purchase." });
    }
  };
  
  const handleConfirmClick = async () => {
    if (didBuy === 'yes' && supplier.trim() && amount.trim()) {
        const success = await handleAddPurchase();
        if (!success) {
            return; // Don't proceed if adding the final item fails
        }
    }
    if (mode === 'query') {
      onConfirm();
    }
    onOpenChange(false);
  };
  
  const totalAmount = purchases.reduce((sum, p) => sum + p.amount, 0).toFixed(2);


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
            <DialogHeader>
                <DialogTitle>Log Material Purchases</DialogTitle>
                <DialogDescription>
                    {mode === 'query' ? 'Before you go on-site, please log any materials you purchased for this shift.' : 'Add any additional purchases for this shift.'}
                </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
                {mode === 'query' && (
                    <RadioGroup value={didBuy} onValueChange={(value) => setDidBuy(value as 'yes' | 'no')} className="flex items-center space-x-4">
                        <Label>Did you buy any materials for this shift?</Label>
                        <div className="flex items-center space-x-2"><RadioGroupItem value="no" id="mat-no" /><Label htmlFor="mat-no">No</Label></div>
                        <div className="flex items-center space-x-2"><RadioGroupItem value="yes" id="mat-yes" /><Label htmlFor="mat-yes">Yes</Label></div>
                    </RadioGroup>
                )}

                {didBuy === 'yes' && (
                    <div className="space-y-4 pt-4 border-t">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
                            <div className="col-span-3 sm:col-span-2 grid grid-cols-2 gap-2">
                                <div className="space-y-1">
                                    <Label htmlFor="supplier">Supplier</Label>
                                    <Input id="supplier" value={supplier} onChange={e => setSupplier(e.target.value)} placeholder="e.g., Screwfix" />
                                </div>
                                <div className="space-y-1">
                                    <Label htmlFor="amount">Amount (£)</Label>
                                    <Input id="amount" type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="e.g., 25.50" />
                                </div>
                            </div>
                            <Button onClick={handleAddPurchase} className="w-full sm:w-auto"><Plus className="mr-2 h-4 w-4" /> Add Purchase</Button>
                        </div>

                        {loading ? <Spinner /> : purchases.length > 0 && (
                            <div className="space-y-2">
                                <Label>Logged Purchases</Label>
                                <div className="border rounded-md max-h-48 overflow-y-auto">
                                <Table>
                                    <TableBody>
                                        {purchases.map(p => (
                                            <TableRow key={p.id}>
                                                <TableCell className="font-medium">{p.supplier}</TableCell>
                                                <TableCell className="text-right font-mono">£{p.amount.toFixed(2)}</TableCell>
                                                <TableCell className="text-right w-10 p-1">
                                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive/70" onClick={() => handleDeletePurchase(p.id)}><Trash2 className="h-4 w-4" /></Button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                        <TableRow className="font-bold bg-muted/50">
                                            <TableCell>Total</TableCell>
                                            <TableCell className="text-right font-mono">£{totalAmount}</TableCell>
                                            <TableCell></TableCell>
                                        </TableRow>
                                    </TableBody>
                                </Table>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
            <DialogFooter>
                <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button onClick={handleConfirmClick}>Confirm</Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
  );
}


interface ShiftCardProps {
  shift: Shift;
  userProfile: UserProfile | null;
  onDismiss?: (shiftId: string) => void;
}

type TaskStatus =
  | { status: 'completed' }
  | { status: 'rejected'; note: string };

const shiftTypeDetails = {
  am: { icon: Sunrise, label: 'AM Shift', color: 'bg-sky-500' },
  pm: { icon: Sunset, label: 'PM Shift', color: 'bg-orange-500' },
  'all-day': { icon: Clock, label: 'All Day', color: 'bg-indigo-500' },
};

const statusDetails: {
  [key in ShiftStatus]: {
    label: string;
    variant: 'default' | 'secondary' | 'destructive' | 'outline';
    className: string;
    icon: React.ElementType;
  };
} = {
  'pending-confirmation': {
    label: 'Pending',
    variant: 'secondary',
    className: '',
    icon: AlertTriangle,
  },
  confirmed: {
    label: 'Confirmed',
    variant: 'default',
    className: 'bg-primary hover:bg-primary/90',
    icon: ThumbsUp,
  },
  'on-site': {
    label: 'On Site',
    variant: 'default',
    className: 'bg-teal-500 hover:bg-teal-600',
    icon: HardHat,
  },
  completed: {
    label: 'Completed',
    variant: 'default',
    className: 'bg-green-600 hover:bg-green-700',
    icon: CheckCircle2,
  },
  incomplete: {
    label: 'Incomplete',
    variant: 'destructive',
    className: 'bg-amber-600 hover:bg-amber-700 text-white border-amber-600',
    icon: XCircle,
  },
  rejected: {
    label: 'Rejected',
    variant: 'destructive',
    className: 'bg-destructive/80 hover:bg-destructive/90 text-white border-destructive/80',
    icon: XCircle,
  },
};

const expiredStatusInfo = {
  label: 'Expired',
  variant: 'outline' as const,
  className: 'text-muted-foreground border-muted-foreground/30',
  icon: AlertTriangle,
};

const FINAL_STATUSES = new Set(['completed', 'incomplete', 'rejected']);

const LS_SHIFT_TASKS_KEY = 'shiftTaskCompletion_v2';

export function ShiftCard({ shift, userProfile, onDismiss }: ShiftCardProps) {
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();

  const [isLoading, setIsLoading] = useState(false);
  const [isNoteDialogOpen, setIsNoteDialogOpen] = useState(false);
  const [isRejectNoteDialogOpen, setRejectNoteDialogOpen] = useState(false);
  const [rejectionNote, setRejectionNote] = useState('');
  const [rejectingTaskIndex, setRejectingTaskIndex] = useState<number | null>(null);
  const [note, setNote] = useState('');

  const [tradeTasks, setTradeTasks] = useState<TradeTask[]>([]);
  const [taskStatuses, setTaskStatuses] = useState<{ [key: number]: TaskStatus }>({});

  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [selectedCameraTask, setSelectedCameraTask] = useState<{task: TradeTask, index: number} | null>(null);

  const [purchases, setPurchases] = useState<MaterialPurchase[]>([]);
  const [isPurchaseLogOpen, setIsPurchaseLogOpen] = useState(false);
  const [purchaseLogMode, setPurchaseLogMode] = useState<'query' | 'add'>('query');

  const d = shift.date.toDate();
  const shiftDate = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const shiftDay = new Date(shiftDate);
  shiftDay.setHours(0, 0, 0, 0);

  const rawStatusLower = String(shift.status || '').toLowerCase();
  const isFinalStatus = FINAL_STATUSES.has(rawStatusLower);
  const isExpired = !isFinalStatus && shiftDay.getTime() < today.getTime();

  const ShiftIcon = shiftTypeDetails[shift.type].icon;

  const statusInfo = isExpired ? expiredStatusInfo : statusDetails[shift.status];
  const StatusIcon = statusInfo.icon;

  const isHistorical = shift.status === 'completed' || shift.status === 'incomplete';
  const allTasksCompleted =
    tradeTasks.length === 0 ||
    tradeTasks.every(
      (_, index) =>
        taskStatuses[index]?.status === 'completed' ||
        taskStatuses[index]?.status === 'rejected'
    );

  // --- Purchase Logic ---
  useEffect(() => {
    if (!shift.id) return;
    const purchasesQuery = query(collection(db, `shifts/${shift.id}/materialPurchases`), orderBy('purchasedAt', 'asc'));
    const unsubscribe = onSnapshot(purchasesQuery, (snapshot) => {
        setPurchases(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as MaterialPurchase)));
    });
    return () => unsubscribe();
  }, [shift.id]);

  const handleDeletePurchase = async (purchaseId: string) => {
    try {
        await deleteDoc(doc(db, `shifts/${shift.id}/materialPurchases`, purchaseId));
        toast({ title: 'Purchase removed.' });
    } catch(e) {
        toast({ variant: 'destructive', title: 'Could not remove purchase' });
    }
  };

  const handleLogPurchaseClick = () => {
    setPurchaseLogMode('add');
    setIsPurchaseLogOpen(true);
  };
  
  const handleConfirmPurchasesAndGoOnSite = () => {
    handleUpdateStatus('on-site');
  };


  useEffect(() => {
    async function fetchTasks() {
      if (!userProfile || !db) return;

      const categoryName = userProfile.trade || userProfile.role;

      if (categoryName) {
        try {
          const q = query(collection(db, 'trade_tasks'), where('name', '==', categoryName));
          const querySnapshot = await getDocs(q);
          if (!querySnapshot.empty) {
            const tradeData = querySnapshot.docs[0].data() as Trade;
            setTradeTasks(tradeData.tasks || []);
          } else {
            setTradeTasks([]);
          }
        } catch (e) {
          console.error(`Failed to load tasks for category "${categoryName}" from Firestore`, e);
          setTradeTasks([]);
        }
      } else {
        setTradeTasks([]);
      }
    }
    fetchTasks();
  }, [userProfile, shift.userId]);

  useEffect(() => {
    if (tradeTasks.length > 0) {
      try {
        const allShiftTasks = JSON.parse(localStorage.getItem(LS_SHIFT_TASKS_KEY) || '{}');
        const shiftTaskStatuses = allShiftTasks[shift.id];
        if (shiftTaskStatuses) {
          setTaskStatuses(shiftTaskStatuses);
        } else {
          setTaskStatuses({});
        }
      } catch (e) {
        console.error('Failed to load shift task completion state', e);
        setTaskStatuses({});
      }
    }
  }, [shift.id, tradeTasks.length]);

  const updateAndStoreTaskStatuses = (newStatuses: { [key: number]: TaskStatus }) => {
    setTaskStatuses(newStatuses);
    try {
      const allShiftTasks = JSON.parse(localStorage.getItem(LS_SHIFT_TASKS_KEY) || '{}');
      allShiftTasks[shift.id] = newStatuses;
      localStorage.setItem(LS_SHIFT_TASKS_KEY, JSON.stringify(allShiftTasks));
    } catch (e) {
      console.error('Failed to save shift task completion state', e);
    }
  };

  const handleTaskToggle = (taskIndex: number) => {
    const task = tradeTasks[taskIndex];
    if (task.photoRequired && !taskStatuses[taskIndex]) {
        setSelectedCameraTask({ task, index: taskIndex });
        setIsCameraOpen(true);
        return;
    }

    const newStatuses = { ...taskStatuses };
    if (newStatuses[taskIndex]) {
      delete newStatuses[taskIndex];
    } else {
      newStatuses[taskIndex] = { status: 'completed' };
    }
    updateAndStoreTaskStatuses(newStatuses);
  };

  const handleOpenRejectDialog = (taskIndex: number) => {
    setRejectingTaskIndex(taskIndex);
    setRejectNoteDialogOpen(true);
  };

  const handleRejectSubmit = () => {
    if (rejectingTaskIndex === null || !rejectionNote.trim()) {
      toast({
        variant: 'destructive',
        title: 'Reason Required',
        description: 'Please provide a reason for rejecting the task.',
      });
      return;
    }
    const newStatuses = { ...taskStatuses };
    newStatuses[rejectingTaskIndex] = { status: 'rejected', note: rejectionNote.trim() };
    updateAndStoreTaskStatuses(newStatuses);
    setRejectNoteDialogOpen(false);
    setRejectionNote('');
    setRejectingTaskIndex(null);
  };

  const handleUndoReject = (taskIndex: number) => {
    const newStatuses = { ...taskStatuses };
    delete newStatuses[taskIndex];
    updateAndStoreTaskStatuses(newStatuses);
  };

  const handlePhotoUpload = async (filesToUpload: File[]) => {
    if (!selectedCameraTask) return;
    
    setIsLoading(true);
    try {
      if (!db || !storage || !userProfile) throw new Error('Services not ready');

      const projectsQuery = query(collection(db, 'projects'), where('address', '==', shift.address));
      const projectSnapshot = await getDocs(projectsQuery);

      if (projectSnapshot.empty) {
        toast({
          variant: 'destructive',
          title: 'Project Not Found',
          description: `No project found with address: ${shift.address}`,
        });
        throw new Error('Project not found');
      }
      const projectId = projectSnapshot.docs[0].id;
      
      const uploadPromises = filesToUpload.map(file => {
          const storagePath = `project_files/${projectId}/${Date.now()}-${file.name}`;
          const storageRef = ref(storage, storagePath);
          const uploadTask = uploadBytesResumable(storageRef, file);

          return new Promise<void>(async (resolve, reject) => {
            try {
              await uploadTask;
              const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);

              await addDoc(collection(db, `projects/${projectId}/files`), {
                name: file.name,
                url: downloadURL,
                fullPath: storagePath,
                size: file.size,
                type: file.type,
                uploadedAt: serverTimestamp(),
                uploaderId: userProfile?.uid || "system",
                uploaderName: userProfile.name,
                evidenceTag: selectedCameraTask.task.evidenceTag || '',
              });
              resolve();
            } catch (error) {
                reject(error);
            }
          });
      });
      
      await Promise.all(uploadPromises);

      const newStatuses = { ...taskStatuses };
      newStatuses[selectedCameraTask.index] = { status: 'completed' };
      updateAndStoreTaskStatuses(newStatuses);

      toast({ title: 'Photos Uploaded', description: `${filesToUpload.length} photo(s) uploaded and task completed.` });
    } catch (error: any) {
      console.error('Photo upload failed:', error);
      toast({
        variant: 'destructive',
        title: 'Upload Failed',
        description: error.message || 'Could not upload photos.',
      });
    } finally {
      setIsLoading(false);
      setSelectedCameraTask(null);
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

    if (isExpired) {
      toast({
        variant: 'destructive',
        title: 'Shift Expired',
        description: 'This shift is in the past and can no longer be updated.',
      });
      return;
    }

    setIsLoading(true);
    try {
      const shiftRef = doc(db, 'shifts', shift.id);

      const updateData: {
        status: ShiftStatus;
        notes?: any;
        updatedByUid: string;
        updatedByAction: string;
        updatedAt: any;
      } = {
        status: newStatus,
        updatedByUid: user.uid,
        updatedByAction: String(newStatus),
        updatedAt: serverTimestamp(),
      };

      if (notes) updateData.notes = notes;
      else if (newStatus === 'confirmed') updateData.notes = deleteField();

      await updateDoc(shiftRef, updateData as any);

      toast({
        title: 'Shift status updated',
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
      toast({
        variant: 'destructive',
        title: 'Note Required',
        description: 'Please provide a note explaining why the shift is incomplete.',
      });
      return;
    }
    handleUpdateStatus('incomplete', note.trim());
  };

  const renderTaskList = () => {
    if (shift.status !== 'on-site' || tradeTasks.length === 0) return null;
    if (isExpired) return null;

    return (
      <div className="mt-4 p-4 border-t">
        <h4 className="font-semibold text-sm mb-3 flex items-center gap-2 text-muted-foreground">
          <ListChecks /> Checklist
        </h4>
        <div className="space-y-3">
          {tradeTasks.map((task, index) => {
            const status = taskStatuses[index];
            return (
              <div key={index} className="flex items-start space-x-3">
                <Checkbox
                  id={`task-${shift.id}-${index}`}
                  checked={status?.status === 'completed'}
                  onCheckedChange={() => handleTaskToggle(index)}
                  disabled={isLoading || status?.status === 'rejected'}
                  className="mt-1"
                />
                <div className="flex-grow">
                  <Label
                    htmlFor={`task-${shift.id}-${index}`}
                    className="text-sm font-normal text-foreground flex-grow cursor-pointer flex items-center justify-between"
                  >
                    <span
                      className={status?.status === 'rejected' ? 'line-through text-muted-foreground' : ''}
                    >
                      {task.text}
                    </span>
                    <div className="flex items-center gap-1">
                      {task.photoRequired && (
                        <div className="flex items-center gap-1 text-muted-foreground">
                           <Camera className="h-4 w-4" />
                           {task.photoCount && task.photoCount > 1 && <span className="text-xs">x{task.photoCount}</span>}
                        </div>
                      )}
                      {status?.status !== 'rejected' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => handleOpenRejectDialog(index)}
                          disabled={isLoading}
                        >
                          <XCircle className="h-4 w-4 text-destructive/70 hover:text-destructive" />
                        </Button>
                      )}
                    </div>
                  </Label>

                  {status?.status === 'rejected' && (
                    <div className="mt-1 p-2 bg-destructive/10 rounded-md text-xs text-destructive">
                      <p className="font-semibold flex items-center">
                        Rejected: <span className="italic font-normal ml-1">"{status.note}"</span>
                      </p>
                      <Button
                        variant="link"
                        size="sm"
                        className="h-auto p-0 mt-1 text-destructive"
                        onClick={() => handleUndoReject(index)}
                      >
                        <Undo className="mr-1 h-3 w-3" /> Undo
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };
  
  const renderPurchaseLog = () => {
    // Only show this section for shifts where purchases can be logged.
    if (!['on-site', 'completed', 'incomplete'].includes(shift.status)) {
        return null;
    }

    // Don't show for past shifts that were never closed out.
    if (isExpired) {
        return null;
    }

    const totalAmount = purchases.reduce((sum, p) => sum + p.amount, 0).toFixed(2);

    return (
        <div className="mt-4 p-4 border-t">
             <div className="flex justify-between items-center mb-3">
                <h4 className="font-semibold text-sm flex items-center gap-2 text-muted-foreground">
                  <Coins /> Logged Purchases
                </h4>
                <Button size="sm" className="bg-teal-500 hover:bg-teal-600 text-white" onClick={handleLogPurchaseClick}>
                    <Plus className="mr-2 h-4 w-4" /> Add
                </Button>
             </div>
             {purchases.length > 0 ? (
                 <div className="border rounded-md max-h-48 overflow-y-auto">
                    <Table>
                        <TableBody>
                            {purchases.map(p => (
                                <TableRow key={p.id}>
                                    <TableCell className="font-medium">{p.supplier}</TableCell>
                                    <TableCell className="text-right font-mono">£{p.amount.toFixed(2)}</TableCell>
                                    <TableCell className="text-right p-1 w-10">
                                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive/70" onClick={() => handleDeletePurchase(p.id)}><Trash2 className="h-4 w-4" /></Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                             <TableRow className="font-bold bg-muted/50">
                                <TableCell>Total</TableCell>
                                <TableCell className="text-right font-mono">£{totalAmount}</TableCell>
                                <TableCell></TableCell>
                            </TableRow>
                        </TableBody>
                    </Table>
                 </div>
             ) : (
                <div className="text-sm text-muted-foreground text-center p-4 border rounded-md border-dashed">
                    No materials have been logged for this shift yet.
                </div>
             )}
        </div>
    )
  }

  return (
    <>
      <Card className="flex flex-col overflow-hidden transition-all hover:shadow-xl border-border hover:border-primary/40">
        <CardHeader className="flex flex-row items-start justify-between space-y-0 bg-card p-4">
          <div className="flex items-center gap-3">
            <div
              className={`flex items-center justify-center rounded-lg w-12 h-12 ${shiftTypeDetails[shift.type].color}`}
            >
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
          <a
            href={`https://maps.google.com/?q=${encodeURIComponent(shift.address)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:underline flex items-center gap-1.5"
          >
            <MapPin className="h-4 w-4 shrink-0" />
            <span className="whitespace-pre-wrap">{shift.address}</span>
          </a>
          {shift.eNumber && <p className="text-xs text-muted-foreground">Number: {shift.eNumber}</p>}
          {shift.manager && <p className="text-xs text-muted-foreground">Manager: {shift.manager}</p>}
          
          {shift.notes && (shift.status !== 'incomplete' && shift.status !== 'rejected') && (
             <div className="mt-3 p-3 bg-muted/50 border-l-4 border-muted-foreground/30 rounded-r-md">
              <p className="text-sm font-semibold text-muted-foreground">Notes:</p>
              <p className="text-sm text-foreground whitespace-pre-wrap">{shift.notes}</p>
            </div>
          )}

          {(shift.status === 'incomplete' || shift.status === 'rejected') && shift.notes && (
            <div className="mt-3 p-3 bg-destructive/10 border-l-4 border-destructive rounded-r-md">
              <p className="text-sm font-semibold text-destructive">Note:</p>
              <p className="text-sm text-destructive/90 italic">"{shift.notes}"</p>
            </div>
          )}

          {isExpired && (
            <div className="mt-3 p-3 bg-muted/40 border-l-4 border-muted rounded-r-md">
              <p className="text-sm font-semibold text-muted-foreground">This shift is in the past.</p>
            </div>
          )}
        </CardContent>

        {renderPurchaseLog()}
        {renderTaskList()}

        <CardFooter className="p-2 bg-muted/30 grid grid-cols-1 gap-2">
          {!isExpired && shift.status === 'pending-confirmation' && (
            <Button
              onClick={() => handleUpdateStatus('confirmed')}
              className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
              disabled={isLoading}
            >
              {isLoading ? <Spinner /> : <><ThumbsUp className="mr-2 h-4 w-4" /> Accept Shift</>}
            </Button>
          )}

          {!isExpired && shift.status === 'confirmed' && (
            <Button
              onClick={() => {
                setPurchaseLogMode('query');
                setIsPurchaseLogOpen(true);
              }}
              className="w-full bg-teal-500 text-white hover:bg-teal-600"
              disabled={isLoading}
            >
              {isLoading ? <Spinner /> : <><HardHat className="mr-2 h-4 w-4" /> On Site</>}
            </Button>
          )}

          {!isExpired && shift.status === 'on-site' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Button
                onClick={() => handleUpdateStatus('completed')}
                className="w-full bg-green-500 text-white hover:bg-green-600"
                disabled={isLoading || !allTasksCompleted}
              >
                {isLoading ? <Spinner /> : <><CheckCircle2 className="mr-2 h-4 w-4" /> Complete</>}
              </Button>
              <Button
                variant="destructive"
                onClick={() => setIsNoteDialogOpen(true)}
                className="w-full bg-amber-600 hover:bg-amber-700"
                disabled={isLoading}
              >
                {isLoading ? <Spinner /> : <><XCircle className="mr-2 h-4 w-4" /> Incomplete</>}
              </Button>
            </div>
          )}

          {isHistorical && (
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                onClick={() => handleUpdateStatus('confirmed')}
                className="w-full"
                disabled={isLoading}
              >
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

      <PurchaseLogDialog
        open={isPurchaseLogOpen}
        onOpenChange={setIsPurchaseLogOpen}
        onConfirm={handleConfirmPurchasesAndGoOnSite}
        mode={purchaseLogMode}
        shiftId={shift.id}
        userProfile={userProfile}
      />

      {selectedCameraTask && (
        <MultiPhotoCamera
            open={isCameraOpen}
            onOpenChange={setIsCameraOpen}
            requiredCount={selectedCameraTask.task.photoCount || 1}
            onUploadComplete={handlePhotoUpload}
            taskName={selectedCameraTask.task.text}
        />
      )}

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
            <Button
              onClick={() => handleIncompleteSubmit()}
              disabled={isLoading}
              className="bg-amber-600 hover:bg-amber-700"
            >
              {isLoading ? <Spinner /> : 'Submit Note'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isRejectNoteDialogOpen} onOpenChange={setRejectNoteDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Reason for Rejection</DialogTitle>
            <DialogDescription>Please explain why you could not complete this task.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid w-full gap-1.5">
              <Label htmlFor="rejection-note">Reason</Label>
              <Textarea
                placeholder="e.g., incorrect materials, access issue..."
                id="rejection-note"
                value={rejectionNote}
                onChange={(e) => setRejectionNote(e.target.value)}
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectNoteDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleRejectSubmit} disabled={isLoading} variant="destructive">
              {isLoading ? <Spinner /> : 'Submit Reason'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
