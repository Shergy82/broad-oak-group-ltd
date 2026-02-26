'use client';

import { useState, useEffect, useMemo } from 'react';
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
import type { Trade, TradeTask, UserProfile } from '@/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useUserProfile } from '@/hooks/use-user-profile';

export function TaskManager() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTradeName, setNewTradeName] = useState('');
  const [newSubTaskText, setNewSubTaskText] = useState<{ [key: string]: string }>({});
  const [newSubTaskPhotoRequired, setNewSubTaskPhotoRequired] = useState<{ [key: string]: boolean }>({});
  const [newSubTaskEvidenceTag, setNewSubTaskEvidenceTag] = useState<{ [key: string]: string }>({});
  const [newSubTaskPhotoCount, setNewSubTaskPhotoCount] = useState<{ [key: string]: number }>({});
  const { toast } = useToast();
  const { userProfile } = useUserProfile();

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
  
  const filteredTrades = useMemo(() => {
    if (!userProfile) return [];
    if (userProfile.role === 'owner') return trades;
    return trades.filter(trade => !trade.department || trade.department === userProfile.department);
  }, [trades, userProfile]);

  const handleAddTrade = async () => {
    if (!newTradeName.trim()) {
      toast({ variant: 'destructive', title: 'Category name cannot be empty.' });
      return;
    }
    if (!db || !userProfile) return;

    try {
      const isOwner = userProfile.role === 'owner';
      const payload: { name: string; tasks: any[]; department?: string } = {
        name: newTradeName.trim(),
        tasks: [],
      };
      if (!isOwner) {
        payload.department = userProfile.department;
      }
      
      await addDoc(collection(db, 'trade_tasks'), payload);
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
    const photoCount = newSubTaskPhotoCount[tradeId] || 1;
    const tradeDocRef = doc(db, 'trade_tasks', tradeId);
    
    const newTask: TradeTask = { text: taskText, photoRequired };
    if (photoRequired && evidenceTag) {
        newTask.evidenceTag = evidenceTag;
    }
    if (photoRequired && photoCount > 0) {
        newTask.photoCount = photoCount;
    }

    try {
      await updateDoc(tradeDocRef, {
        tasks: arrayUnion(newTask)
      });
      setNewSubTaskText({ ...newSubTaskText, [tradeId]: '' });
      setNewSubTaskPhotoRequired({ ...newSubTaskPhotoRequired, [tradeId]: false });
      setNewSubTaskEvidenceTag({ ...newSubTaskEvidenceTag, [tradeId]: '' });
      setNewSubTaskPhotoCount({ ...newSubTaskPhotoCount, [tradeId]: 1 });
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

        {filteredTrades.length > 0 ? (
          <Accordion type="multiple" className="w-full">
            {filteredTrades.map((trade) => (
              <AccordionItem key={trade.id} value={trade.id}>
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex w-full items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span className="font-semibold text-lg">{trade.name}</span>
                        {trade.department && <span className="text-sm font-normal text-muted-foreground">({trade.department})</span>}
                    </div>
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
                          <Label htmlFor={`photo-required-${trade.id}`} className="text-sm font-normal">Photo Required</Label>
                        </div>
                        
                        {newSubTaskPhotoRequired[trade.id] && (
                            <div className="flex-grow flex flex-col sm:flex-row gap-4 items-center">
                                <div className="flex items-center gap-2">
                                    <Select
                                        value={(newSubTaskPhotoCount[trade.id] || 1).toString()}
                                        onValueChange={(value) => setNewSubTaskPhotoCount({ ...newSubTaskPhotoCount, [trade.id]: parseInt(value, 10) || 1 })}
                                    >
                                        <SelectTrigger className="w-20 h-8">
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
                                 <div className="flex items-center gap-2 w-full flex-grow">
                                    <Tags className="h-4 w-4 text-muted-foreground" />
                                    <Input 
                                        placeholder="Evidence Tag (e.g., boiler-photo)"
                                        value={newSubTaskEvidenceTag[trade.id] || ''}
                                        onChange={(e) => setNewSubTaskEvidenceTag({...newSubTaskEvidenceTag, [trade.id]: e.target.value})}
                                        className="h-8 flex-grow"
                                    />
                                </div>
                            </div>
                        )}
                        
                        <Button size="sm" onClick={() => handleAddTask(trade.id)} className="w-full sm:w-auto mt-2 sm:mt-0">
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
                                   {task.photoCount && task.photoCount > 1 && (
                                    <span className="text-xs text-muted-foreground">({task.photoCount} photos)</span>
                                  )}
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
