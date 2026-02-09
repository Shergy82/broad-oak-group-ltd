
'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { PlusCircle, Trash2, Camera, Tags } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Checkbox } from '../ui/checkbox';
import { Label } from '../ui/label';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, deleteDoc, doc, updateDoc, arrayUnion, arrayRemove, query, orderBy } from 'firebase/firestore';
import { Spinner } from '../shared/spinner';
import type { Trade, TradeTask } from '@/types';

export function TaskManager() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTradeName, setNewTradeName] = useState('');
  const [newSubTaskText, setNewSubTaskText] = useState<{ [key: string]: string }>({});
  const [newSubTaskPhotoRequired, setNewSubTaskPhotoRequired] = useState<{ [key: string]: boolean }>({});
  const [newSubTaskEvidenceTag, setNewSubTaskEvidenceTag] = useState<{ [key: string]: string }>({});
  const { toast } = useToast();

  useEffect(() => {
    if (!db) {
      setLoading(false);
      return;
    }
    const q = query(collection(db, 'trade_tasks'), orderBy('name'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedTrades = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Trade));
      setTrades(fetchedTrades);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching trades: ", error);
      toast({
        variant: 'destructive',
        title: 'Error Loading Data',
        description: 'Could not load tasks from the database. Check Firestore rules.',
      });
      setLoading(false);
    });

    return () => unsubscribe();
  }, [toast]);

  const handleAddTrade = async () => {
    if (!newTradeName.trim()) {
      toast({ variant: 'destructive', title: 'Category name cannot be empty.' });
      return;
    }
    if (!db) return;

    try {
      await addDoc(collection(db, 'trade_tasks'), {
        name: newTradeName.trim(),
        tasks: [],
      });
      setNewTradeName('');
      toast({ title: 'Success', description: `Category "${newTradeName.trim()}" added.` });
    } catch (error) {
      console.error('Error adding trade: ', error);
      toast({ variant: 'destructive', title: 'Error', description: 'Could not add category. Check permissions.' });
    }
  };

  const handleDeleteTrade = async (tradeId: string) => {
    if (!db) return;
    try {
      await deleteDoc(doc(db, 'trade_tasks', tradeId));
      toast({ title: 'Success', description: 'Category deleted.' });
    } catch (error) {
      console.error('Error deleting trade: ', error);
      toast({ variant: 'destructive', title: 'Error', description: 'Could not delete category.' });
    }
  };

  const handleAddTask = async (tradeId: string) => {
    const taskText = newSubTaskText[tradeId]?.trim();
    if (!taskText) {
      toast({ variant: 'destructive', title: 'Task name cannot be empty.' });
      return;
    }
    if (!db) return;

    const photoRequired = newSubTaskPhotoRequired[tradeId] || false;
    const evidenceTag = newSubTaskEvidenceTag[tradeId]?.trim() || '';
    const tradeDocRef = doc(db, 'trade_tasks', tradeId);
    
    const newTask: TradeTask = { text: taskText, photoRequired };
    if (photoRequired && evidenceTag) {
        newTask.evidenceTag = evidenceTag;
    }

    try {
      await updateDoc(tradeDocRef, {
        tasks: arrayUnion(newTask)
      });
      setNewSubTaskText({ ...newSubTaskText, [tradeId]: '' });
      setNewSubTaskPhotoRequired({ ...newSubTaskPhotoRequired, [tradeId]: false });
      setNewSubTaskEvidenceTag({ ...newSubTaskEvidenceTag, [tradeId]: '' });
      toast({ title: 'Success', description: `Task added.` });
    } catch (error) {
      console.error('Error adding task: ', error);
      toast({ variant: 'destructive', title: 'Error', description: 'Could not add task.' });
    }
  };

  const handleDeleteTask = async (tradeId: string, taskToDelete: TradeTask) => {
    if (!db) return;
    const tradeDocRef = doc(db, 'trade_tasks', tradeId);

    try {
      await updateDoc(tradeDocRef, {
        tasks: arrayRemove(taskToDelete)
      });
      toast({ title: 'Success', description: 'Task deleted.' });
    } catch (error) {
      console.error('Error deleting task: ', error);
      toast({ variant: 'destructive', title: 'Error', description: 'Could not delete task.' });
    }
  };

  if (loading) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Task Management</CardTitle>
                <CardDescription>
                Create and manage reusable tasks organized by category (e.g., trade or role).
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div className="flex items-center justify-center h-48">
                    <Spinner size="lg" />
                </div>
            </CardContent>
        </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Task Management</CardTitle>
        <CardDescription>
          Create and manage reusable tasks organized by category (e.g., trade or role). This data is stored centrally for all users.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex gap-2">
          <Input
            placeholder="e.g., Plumber, Owner..."
            value={newTradeName}
            onChange={(e) => setNewTradeName(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleAddTrade()}
          />
          <Button onClick={handleAddTrade}>
            <PlusCircle className="mr-2 h-4 w-4" /> Add Category
          </Button>
        </div>

        {trades.length > 0 ? (
          <Accordion type="multiple" className="w-full">
            {trades.map((trade) => (
              <AccordionItem key={trade.id} value={trade.id}>
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex w-full items-center justify-between">
                    <span className="font-semibold text-lg">{trade.name}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive/70 hover:text-destructive hover:bg-destructive/10"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteTrade(trade.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="p-4 bg-muted/30 rounded-b-md">
                  <div className="space-y-4">
                    <div className="space-y-3 p-3 border bg-background rounded-md">
                      <Input
                        placeholder="Add a new sub-task..."
                        value={newSubTaskText[trade.id] || ''}
                        onChange={(e) => setNewSubTaskText({ ...newSubTaskText, [trade.id]: e.target.value })}
                        onKeyPress={(e) => e.key === 'Enter' && handleAddTask(trade.id)}
                      />
                      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id={`photo-required-${trade.id}`}
                            checked={newSubTaskPhotoRequired[trade.id] || false}
                            onCheckedChange={(checked) => setNewSubTaskPhotoRequired({ ...newSubTaskPhotoRequired, [trade.id]: !!checked })}
                          />
                          <Label htmlFor={`photo-required-${trade.id}`} className="text-sm">Photo Required</Label>
                        </div>
                        
                        {newSubTaskPhotoRequired[trade.id] && (
                            <div className="flex items-center gap-2 w-full sm:w-auto">
                                <Tags className="h-4 w-4 text-muted-foreground" />
                                <Input 
                                    placeholder="Evidence Tag (e.g., boiler-photo)"
                                    value={newSubTaskEvidenceTag[trade.id] || ''}
                                    onChange={(e) => setNewSubTaskEvidenceTag({...newSubTaskEvidenceTag, [trade.id]: e.target.value})}
                                    className="h-8"
                                />
                            </div>
                        )}
                        <Button size="sm" onClick={() => handleAddTask(trade.id)} className="w-full sm:w-auto">
                          Add Task
                        </Button>
                      </div>
                    </div>
                    {trade.tasks?.length > 0 && (
                      <ul className="space-y-2">
                        {trade.tasks.map((task, index) => (
                          <li
                            key={index}
                            className="flex items-center justify-between p-2 bg-background rounded-md border"
                          >
                            <div className="flex flex-col">
                                <div className="flex items-center gap-2">
                                  <span>{task.text}</span>
                                  {task.photoRequired && <Camera className="h-4 w-4 text-muted-foreground" />}
                                </div>
                                {task.evidenceTag && (
                                    <div className="flex items-center gap-1 mt-1">
                                        <Tags className="h-3 w-3 text-muted-foreground" />
                                        <p className="text-xs text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded">{task.evidenceTag}</p>
                                    </div>
                                )}
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive/70 hover:text-destructive hover:bg-destructive/10"
                              onClick={() => handleDeleteTask(trade.id, task)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
            <h3 className="text-lg font-semibold">No Categories Created Yet</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Add a category using the form above to start organizing your tasks.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
