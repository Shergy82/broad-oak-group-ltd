

'use client';

import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { doc, onSnapshot, setDoc, updateDoc, arrayUnion, arrayRemove, serverTimestamp } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Spinner } from '@/components/shared/spinner';
import { PlusCircle, Trash2, Camera, Tags, Copy } from 'lucide-react';
import type { EvidenceChecklistItem, EvidenceChecklist, Project } from '@/types';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';

interface EvidenceChecklistManagerProps {
  contractName?: string;
  projectId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contractChecklist?: EvidenceChecklistItem[];
  allChecklists?: Map<string, EvidenceChecklist>;
}

export function EvidenceChecklistManager({ contractName, projectId, open, onOpenChange, contractChecklist, allChecklists }: EvidenceChecklistManagerProps) {
  const [items, setItems] = useState<EvidenceChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newItemText, setNewItemText] = useState('');
  const [newItemPhotoCount, setNewItemPhotoCount] = useState(1);
  const [newItemEvidenceTag, setNewItemEvidenceTag] = useState('');
  const { toast } = useToast();

  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [sourceContractForCopy, setSourceContractForCopy] = useState<string | null>(null);
  const [itemsToCopy, setItemsToCopy] = useState<Set<string>>(new Set());

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
  
  const handleSelectSourceContract = (contract: string) => {
    setSourceContractForCopy(contract);
    setCopyDialogOpen(true);
    setItemsToCopy(new Set());
  };

  const handleToggleCopyItem = (itemId: string) => {
    setItemsToCopy(prev => {
        const newSet = new Set(prev);
        if (newSet.has(itemId)) newSet.delete(itemId);
        else newSet.add(itemId);
        return newSet;
    });
  };

  const handleCopyItems = async () => {
    if (!sourceContractForCopy || !allChecklists) return;
    
    const isProjectMode = !!projectId;

    const sourceChecklist = allChecklists.get(sourceContractForCopy);
    if (!sourceChecklist || !sourceChecklist.items) {
        toast({ variant: 'destructive', title: 'Error', description: 'Source contract has no items.' });
        return;
    }

    const itemsToPotentiallyAdd = sourceChecklist.items.filter(item => itemsToCopy.has(item.id));
    if (itemsToPotentiallyAdd.length === 0) {
        toast({ title: 'No items selected', description: 'Please select at least one item to copy.' });
        return;
    }

    const currentItemTexts = new Set(items.map(i => i.text.trim().toLowerCase()));
    const uniqueNewItems = itemsToPotentiallyAdd.filter(item => !currentItemTexts.has(item.text.trim().toLowerCase()));
    
    if (uniqueNewItems.length < itemsToPotentiallyAdd.length) {
        toast({ title: 'Duplicates Skipped', description: `${itemsToPotentiallyAdd.length - uniqueNewItems.length} item(s) were already in the checklist.` });
    }
    
    if (uniqueNewItems.length === 0) {
        setCopyDialogOpen(false);
        return;
    }
    
    const newItemsWithIds = uniqueNewItems.map(item => ({ ...item, id: `${Date.now()}-${Math.random()}` }));

    const docRef = isProjectMode
        ? doc(db, 'projects', projectId)
        : doc(db, 'evidence_checklists', contractName!);

    try {
        if (isProjectMode) {
            const updatedChecklist = [...items, ...newItemsWithIds];
            await setDoc(docRef, { checklist: updatedChecklist }, { merge: true });
        } else {
            if (!contractName) return;
            await setDoc(docRef, { 
                contractName: contractName,
                items: arrayUnion(...newItemsWithIds)
            }, { merge: true });
        }

        toast({ title: 'Success', description: `${newItemsWithIds.length} item(s) copied.` });
        setCopyDialogOpen(false);
    } catch (e) {
        console.error('Error copying items:', e);
        toast({ variant: 'destructive', title: 'Error', description: 'Could not copy items.' });
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
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              placeholder="e.g., Photo of front of property"
              value={newItemText}
              onChange={(e) => setNewItemText(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleAddItem()}
              className="flex-grow"
            />
            <div className="flex items-center gap-2">
                <Select
                    value={newItemPhotoCount.toString()}
                    onValueChange={(value) => setNewItemPhotoCount(parseInt(value, 10) || 1)}
                >
                    <SelectTrigger className="w-20 h-10">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {Array.from({ length: 20 }, (_, i) => i + 1).map(num => (
                            <SelectItem key={num} value={num.toString()}>{num}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <Label className="text-sm text-muted-foreground whitespace-nowrap">photo(s)</Label>
            </div>
            <Button onClick={handleAddItem} className="w-full sm:w-auto">
              <PlusCircle className="mr-2 h-4 w-4" /> Add
            </Button>
            {(!projectId && allChecklists) && (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline"><Copy className="mr-2 h-4 w-4" /> Copy...</Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                        {Array.from(allChecklists.keys()).filter(name => name !== contractName && allChecklists.get(name)?.items?.length).map(name => (
                            <DropdownMenuItem key={name} onSelect={() => handleSelectSourceContract(name)}>
                                From "{name}"
                            </DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
            )}
             {(projectId && allChecklists) && (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline"><Copy className="mr-2 h-4 w-4" /> Copy from Contract</Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                        {Array.from(allChecklists.keys()).filter(name => allChecklists.get(name)?.items?.length).map(name => (
                            <DropdownMenuItem key={name} onSelect={() => handleSelectSourceContract(name)}>
                                From "{name}"
                            </DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
            )}
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
    {sourceContractForCopy && (
        <Dialog open={copyDialogOpen} onOpenChange={setCopyDialogOpen}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Copy items from "{sourceContractForCopy}"</DialogTitle>
                    <DialogDescription>Select the items to copy. Existing items will be skipped.</DialogDescription>
                </DialogHeader>

                {(() => {
                    const sourceItems = allChecklists?.get(sourceContractForCopy)?.items || [];
                    const areAllSelected = sourceItems.length > 0 && itemsToCopy.size === sourceItems.length;

                    const handleToggleAllCopyItems = () => {
                        if (areAllSelected) {
                            setItemsToCopy(new Set());
                        } else {
                            setItemsToCopy(new Set(sourceItems.map(item => item.id)));
                        }
                    };

                    return (
                        <>
                            <div className="flex items-center space-x-2 border-b pb-2 mb-2">
                                <Checkbox 
                                    id="copy-all" 
                                    checked={areAllSelected}
                                    onCheckedChange={handleToggleAllCopyItems}
                                />
                                <Label htmlFor="copy-all" className="font-semibold">Select All</Label>
                            </div>
                            <ScrollArea className="max-h-64 border rounded-md my-4">
                                <div className="p-4 space-y-2">
                                    {sourceItems.map(item => (
                                        <div key={item.id} className="flex items-center space-x-2">
                                            <Checkbox 
                                                id={`copy-${item.id}`}
                                                checked={itemsToCopy.has(item.id)}
                                                onCheckedChange={() => handleToggleCopyItem(item.id)}
                                            />
                                            <Label htmlFor={`copy-${item.id}`} className="font-normal">{item.text}</Label>
                                        </div>
                                    ))}
                                </div>
                            </ScrollArea>
                        </>
                    );
                })()}

                <DialogFooter>
                    <Button variant="outline" onClick={() => setCopyDialogOpen(false)}>Cancel</Button>
                    <Button onClick={handleCopyItems}>Copy {itemsToCopy.size} Selected</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )}
    </>
  );
}
