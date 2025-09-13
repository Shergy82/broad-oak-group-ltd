
'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { db } from '@/lib/firebase';
import { collection, addDoc, updateDoc, doc, Timestamp, serverTimestamp } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Spinner } from '@/components/shared/spinner';
import { CalendarIcon, Bug } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import type { Shift, UserProfile } from '@/types';

const formSchema = z.object({
  userId: z.string().min(1, 'An operative must be selected.'),
  date: z.date({ required_error: 'A date is required.' }),
  type: z.enum(['am', 'pm', 'all-day'], { required_error: 'Shift type is required.' }),
  task: z.string().min(1, 'Task description is required.'),
  address: z.string().min(1, 'Address is required.'),
  bNumber: z.string().optional(),
});

interface ShiftFormDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    users: UserProfile[];
    shift: Shift | null;
    userProfile: UserProfile;
}

export function ShiftFormDialog({ open, onOpenChange, users, shift, userProfile }: ShiftFormDialogProps) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [isDatePickerOpen, setDatePickerOpen] = useState(false);
  const isEditing = !!shift;
  const isOwner = userProfile.role === 'owner';

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      userId: '',
      date: undefined,
      type: 'all-day',
      task: '',
      address: '',
      bNumber: '',
    },
  });
  
  const getCorrectedLocalDate = (date: { toDate: () => Date }) => {
    const d = date.toDate();
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  };

  useEffect(() => {
    if (open) {
      if (shift) {
        form.reset({
          userId: shift.userId,
          date: getCorrectedLocalDate(shift.date),
          type: shift.type,
          task: shift.task,
          address: shift.address,
          bNumber: shift.bNumber || '',
        });
      } else {
        form.reset({
          userId: '',
          date: undefined,
          type: 'all-day',
          task: '',
          address: '',
          bNumber: '',
        });
      }
    }
  }, [shift, open, form]);

  const handleSubmit = async (values: z.infer<typeof formSchema>) => {
    if (!db) return;
    setIsLoading(true);

    const dataToSave = {
      ...values,
      date: Timestamp.fromDate(values.date),
      bNumber: values.bNumber || '',
    };
    
    try {
      if (isEditing && shift) {
        const shiftRef = doc(db, 'shifts', shift.id);
        await updateDoc(shiftRef, dataToSave);
        toast({ title: 'Success', description: 'Shift updated.' });
      } else {
        await addDoc(collection(db, 'shifts'), {
          ...dataToSave,
          status: 'pending-confirmation',
          createdAt: serverTimestamp(),
        });
        toast({ title: 'Success', description: 'Shift created.' });
      }
      onOpenChange(false);
    } catch (error) {
      console.error('Error saving shift:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'Could not save shift. Check Firestore rules.' });
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleCreateTestShift = async () => {
    if (!db) return;
    const testUser = users.find(u => u.name.toLowerCase().includes('phil shergold'));
    if (!testUser) {
        toast({
            variant: 'destructive',
            title: 'Test User Not Found',
            description: "Could not find user 'Phil Shergold'. Please ensure the user exists."
        });
        return;
    }
    
    setIsLoading(true);
    try {
        await addDoc(collection(db, 'shifts'), {
            userId: testUser.uid,
            date: Timestamp.fromDate(new Date()),
            type: 'all-day',
            status: 'pending-confirmation',
            address: 'Test Shift Address',
            task: 'This is a test shift for notification.',
            bNumber: 'B-TEST',
            createdAt: serverTimestamp(),
        });
        toast({
            title: 'Test Shift Created',
            description: `A test shift has been created for ${testUser.name} to trigger a notification.`,
        });
        onOpenChange(false);
    } catch (error) {
        console.error('Error creating test shift:', error);
        toast({
            variant: 'destructive',
            title: 'Error',
            description: 'Could not create the test shift. Check Firestore rules and function logs.',
        });
    } finally {
        setIsLoading(false);
    }
  };


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit' : 'Create'} Shift</DialogTitle>
          <DialogDescription>
            {isEditing ? 'Update the details for this shift.' : 'Fill out the form to add a new shift to the schedule.'}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4 py-4">
            <FormField
              control={form.control}
              name="userId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Operative</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select an operative" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {users.map(user => (
                        <SelectItem key={user.uid} value={user.uid}>{user.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="date"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <FormLabel>Date</FormLabel>
                      <Popover open={isDatePickerOpen} onOpenChange={setDatePickerOpen} modal={true}>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              variant={"outline"}
                              className={cn(
                                "pl-3 text-left font-normal",
                                !field.value && "text-muted-foreground"
                              )}
                            >
                              {field.value ? format(field.value, "PPP") : <span>Pick a date</span>}
                              <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={field.value}
                            onSelect={(date) => {
                                field.onChange(date);
                                setDatePickerOpen(false);
                            }}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem className="space-y-3">
                      <FormLabel>Shift Type</FormLabel>
                      <FormControl>
                        <RadioGroup
                          onValueChange={field.onChange}
                          defaultValue={field.value}
                          className="flex items-center space-x-4 pt-1"
                        >
                          <FormItem className="flex items-center space-x-2 space-y-0">
                            <FormControl><RadioGroupItem value="am" /></FormControl>
                            <FormLabel className="font-normal">AM</FormLabel>
                          </FormItem>
                          <FormItem className="flex items-center space-x-2 space-y-0">
                            <FormControl><RadioGroupItem value="pm" /></FormControl>
                            <FormLabel className="font-normal">PM</FormLabel>
                          </FormItem>
                          <FormItem className="flex items-center space-x-2 space-y-0">
                            <FormControl><RadioGroupItem value="all-day" /></FormControl>
                            <FormLabel className="font-normal">All Day</FormLabel>
                          </FormItem>
                        </RadioGroup>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
            </div>

            <FormField
              control={form.control}
              name="address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Address</FormLabel>
                  <FormControl>
                    <Input placeholder="123 Main Street..." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="task"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Task Description</FormLabel>
                  <FormControl>
                    <Textarea placeholder="e.g., First fix electrics" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="bNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>B Number (Optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="B-..." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter className="sm:justify-between">
              {isOwner && !isEditing && (
                <Button type="button" variant="secondary" onClick={handleCreateTestShift} disabled={isLoading}>
                    <Bug className="mr-2 h-4 w-4" /> Create Test Shift
                </Button>
              )}
              <div className="flex gap-2 justify-end">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>Cancel</Button>
                <Button type="submit" disabled={isLoading}>
                  {isLoading ? <Spinner /> : isEditing ? 'Save Changes' : 'Create Shift'}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
