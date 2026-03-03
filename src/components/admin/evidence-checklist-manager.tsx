

'use client';

import { useState, useEffect, useMemo } from 'react';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { doc, onSnapshot, setDoc, updateDoc, arrayUnion, arrayRemove, serverTimestamp, collection, query } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Spinner } from '@/components/shared/spinner';
import { PlusCircle, Trash2, Camera, Tags } from 'lucide-react';
import type { EvidenceChecklistItem, EvidenceChecklist, Project, Trade, TradeTask } from '@/types';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAllUsers } from '@/hooks/use-all-users';
import { useUserProfile } from '@/hooks/use-user-profile';
import { useDepartmentFilter } from '@/hooks/use-department-filter';

interface EvidenceChecklistManagerProps {
  contractName?: string;
  projectId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contractChecklist?: EvidenceChecklistItem[];
  allChecklists?: Map<string, EvidenceChecklist>;
}

export function EvidenceChecklistManager({ contractName, projectId, open, onOpenChange, contractChecklist }: EvidenceChecklistManagerProps) {
  const [items, setItems] = useState<EvidenceChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newItemText, setNewItemText] = useState('');
  const [newItemPhotoCount, setNewItemPhotoCount] = useState(1);
  const [newItemEvidenceTag, setNewItemEvidenceTag] = useState('');
  const { toast } = useToast();
  const { userProfile } = useUserProfile();
  const { users: allUsers, loading: usersLoading } = useAllUsers();
  
  const [allTrades, setAllTrades] = useState<Trade[]>([]);
  const [isTradesLoading, setIsTradesLoading] = useState(true);

  const { allTasksForDropdown } = useMemo(() => {
    if (usersLoading) return { allTasksForDropdown: [] };
    
    const allTasks = allTrades.flatMap(trade => trade.tasks || []);
    
    const taskMap = new Map<string, TradeTask>();
    allTasks.forEach(task => {
        const key = task.text.toLowerCase();
        const existing = taskMap.get(key);

        if (!existing) {
            taskMap.set(key, task);
        } else {
            // Prefer the capitalized version if a duplicate is found
            const isCurrentCapitalized = task.text[0] === task.text[0].toUpperCase();
            const isExistingCapitalized = existing.text[0] === existing.text[0].toUpperCase();

            if (isCurrentCapitalized && !isExistingCapitalized) {
                taskMap.set(key, task);
            }
        }
    });

    const uniqueTasks = Array.from(taskMap.values());
    const allTasksForDropdown = uniqueTasks.sort((a, b) => a.text.localeCompare(b.text));
    
    return { allTasksForDropdown };
  }, [allTrades, allUsers, usersLoading]);

  useEffect(() => {
    if (!open) return;
    setIsTradesLoading(true);
    const q = query(collection(db, 'trade_tasks'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
        const fetchedTrades = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Trade));
        setAllTrades(fetchedTrades.sort((a,b) => a.name.localeCompare(b.name)));
        setIsTradesLoading(false);
    }, (error) => {
        console.error("Error fetching trades:", error);
        setIsTradesLoading(false);
    });

    return () => unsubscribe();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);

    if (!contractName && !projectId) {
        toast({ variant: 'destructive', title: 'Error', description: 'Checklist manager requires a contract or project.' });
        setLoading(false);
        return;
    }

    const docRef = projectId
        ? doc(db, 'projects', projectId)
        : doc(db, 'evidence_checklists', contractName!);

    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (projectId) {
            const projectData = data as Project;
            if ('checklist' in projectData) {
                setItems(projectData.checklist || []);
            } else {
                setItems(contractChecklist || []);
            }
        } else {
            const checklistData = data as EvidenceChecklist;
            setItems(checklistData.items || []);
        }
      } else {
        setItems(projectId ? (contractChecklist || []) : []);
      }
      setLoading(false);
    }, (error) => {
      console.error("Error fetching checklist:", error);
      toast({ variant: 'destructive', title: 'Error', description: 'Could not load checklist.' });
      setLoading(false);
    });

    return () => unsubscribe();
  }, [contractName, projectId, open, toast, contractChecklist]);

  const handleAddItem = async () => {
    if (!newItemText.trim()) return;

    const docRef = projectId
      ? doc(db, 'projects', projectId)
      : doc(db, 'evidence_checklists', contractName!);

    const fieldKey = projectId ? 'checklist' : 'items';
    
    const newItem: EvidenceChecklistItem = { 
        id: new Date().toISOString(), 
        text: newItemText.trim(),
        photoCount: newItemPhotoCount > 0 ? newItemPhotoCount : 1,
        ...(newItemEvidenceTag.trim() && { evidenceTag: newItemEvidenceTag.trim() }),
    };

    const payload: any = {
      [fieldKey]: arrayUnion(newItem),
      updatedAt: serverTimestamp(),
    };

    if (!projectId) {
      payload.contractName = contractName;
    } else {
      const currentItems = [...items, newItem];
      payload[fieldKey] = currentItems;
    }


    try {
      await setDoc(docRef, payload, { merge: true });
      setNewItemText('');
      setNewItemPhotoCount(1);
      setNewItemEvidenceTag('');
      toast({ title: 'Success', description: 'Checklist item added.' });
    } catch (error) {
      console.error('Error adding item:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'Could not add item.' });
    }
  };

  const handleDeleteItem = async (itemToDelete: EvidenceChecklistItem) => {
    const docRef = projectId
      ? doc(db, 'projects', projectId)
      : doc(db, 'evidence_checklists', contractName!);
    const fieldKey = projectId ? 'checklist' : 'items';

    const payload: any = {
        [fieldKey]: arrayRemove(itemToDelete)
    };
    
    if (projectId) {
      const currentItems = items.filter(item => item.id !== itemToDelete.id);
      payload[fieldKey] = currentItems;
    }


    try {
      await updateDoc(docRef, payload);
      toast({ title: 'Success', description: 'Checklist item removed.' });
    } catch (error) {
      console.error('Error deleting item:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'Could not remove item.' });
    }
  };

  const title = projectId ? 'Project-Specific Checklist' : `Evidence Checklist for "${contractName}"`;
  const description = projectId ? 'Manage the specific evidence items for this project. This will override the contract default.' : `Manage the default required evidence items for the "${contractName}" contract.`


  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4">
            <div className="grid grid-cols-1 gap-6">
                <div className="space-y-2">
                    <Label>Add a specific task</Label>
                    <Select
                        onValueChange={(value) => {
                            const selectedTask = allTasksForDropdown.find(t => t.text === value);
                            if (selectedTask) {
                                setNewItemText(selectedTask.text);
                                setNewItemPhotoCount(selectedTask.photoCount || 1);
                                setNewItemEvidenceTag(selectedTask.evidenceTag || selectedTask.text);
                            }
                        }}
                    >
                        <SelectTrigger className="flex-grow">
                            <SelectValue placeholder="Select a pre-defined task..." />
                        </SelectTrigger>
                        <SelectContent>
                            <ScrollArea className="h-64">
                            {(isTradesLoading || usersLoading) ? (
                                <div className="p-4 text-center text-sm text-muted-foreground">Loading tasks...</div>
                            ) : allTasksForDropdown.length > 0 ? (
                                allTasksForDropdown.map(task => (
                                    <SelectItem key={task.text} value={task.text}>{task.text}</SelectItem>
                                ))
                            ) : (
                                <div className="p-4 text-center text-sm text-muted-foreground">No pre-defined tasks found.</div>
                            )}
                            </ScrollArea>
                        </SelectContent>
                    </Select>
                    <div className="flex items-center gap-2 pt-2">
                        <Select
                            value={newItemPhotoCount.toString()}
                            onValueChange={(value) => setNewItemPhotoCount(parseInt(value, 10) || 1)}
                        >
                            <SelectTrigger className="w-20">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {Array.from({ length: 20 }, (_, i) => i + 1).map(num => (
                                    <SelectItem key={num} value={num.toString()}>{num}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Label className="text-sm text-muted-foreground whitespace-nowrap">photo(s)</Label>
                         <Button onClick={handleAddItem} className="ml-auto">
                            <PlusCircle className="mr-2 h-4 w-4" /> Add
                        </Button>
                    </div>
                </div>
            </div>
          
          {loading ? (
            <div className="flex justify-center p-4"><Spinner /></div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto border rounded-md p-2">
              {items && items.length > 0 ? (
                items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between p-2 bg-muted/50 rounded-md">
                    <span>
                        {item.text}
                        {item.photoCount && item.photoCount > 1 && (
                            <span className="text-xs text-muted-foreground ml-2">({item.photoCount} photos)</span>
                        )}
                    </span>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive/70" onClick={() => handleDeleteItem(item)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))
              ) : (
                <p className="text-center text-sm text-muted-foreground p-4">No checklist items yet.</p>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}
