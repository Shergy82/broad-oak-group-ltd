'use client';

import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { doc, onSnapshot, setDoc, updateDoc, arrayUnion, arrayRemove, serverTimestamp } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Spinner } from '@/components/shared/spinner';
import { PlusCircle, Trash2 } from 'lucide-react';

interface EvidenceChecklist {
  contractName: string;
  items: { id: string; text: string }[];
}

interface EvidenceChecklistManagerProps {
  contractName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EvidenceChecklistManager({ contractName, open, onOpenChange }: EvidenceChecklistManagerProps) {
  const [checklist, setChecklist] = useState<EvidenceChecklist | null>(null);
  const [loading, setLoading] = useState(true);
  const [newItemText, setNewItemText] = useState('');
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    setLoading(true);

    const checklistDocRef = doc(db, 'evidence_checklists', contractName);
    const unsubscribe = onSnapshot(checklistDocRef, (docSnap) => {
      if (docSnap.exists()) {
        setChecklist(docSnap.data() as EvidenceChecklist);
      } else {
        setChecklist({ contractName, items: [] });
      }
      setLoading(false);
    }, (error) => {
      console.error("Error fetching checklist:", error);
      toast({ variant: 'destructive', title: 'Error', description: 'Could not load checklist.' });
      setLoading(false);
    });

    return () => unsubscribe();
  }, [contractName, open, toast]);

  const handleAddItem = async () => {
    if (!newItemText.trim()) return;

    const checklistDocRef = doc(db, 'evidence_checklists', contractName);
    const newItem = { id: new Date().toISOString(), text: newItemText.trim() };

    try {
      await setDoc(checklistDocRef, {
        contractName,
        items: arrayUnion(newItem),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      setNewItemText('');
      toast({ title: 'Success', description: 'Checklist item added.' });
    } catch (error) {
      console.error('Error adding item:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'Could not add item.' });
    }
  };

  const handleDeleteItem = async (item: { id: string; text: string }) => {
    const checklistDocRef = doc(db, 'evidence_checklists', contractName);
    try {
      await updateDoc(checklistDocRef, {
        items: arrayRemove(item)
      });
      toast({ title: 'Success', description: 'Checklist item removed.' });
    } catch (error) {
      console.error('Error deleting item:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'Could not remove item.' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Evidence Checklist</DialogTitle>
          <DialogDescription>Manage the required evidence items for the "{contractName}" contract.</DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="e.g., Photo of front of property"
              value={newItemText}
              onChange={(e) => setNewItemText(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleAddItem()}
            />
            <Button onClick={handleAddItem}>
              <PlusCircle className="mr-2 h-4 w-4" /> Add Item
            </Button>
          </div>
          
          {loading ? (
            <div className="flex justify-center p-4"><Spinner /></div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto border rounded-md p-2">
              {checklist?.items && checklist.items.length > 0 ? (
                checklist.items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between p-2 bg-muted/50 rounded-md">
                    <span>{item.text}</span>
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
  );
}
