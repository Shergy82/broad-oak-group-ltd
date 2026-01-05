
'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { db } from '@/lib/firebase';
import { collection, addDoc, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Spinner } from '@/components/shared/spinner';
import type { Announcement, UserProfile } from '@/types';

const formSchema = z.object({
  title: z.string().min(1, 'Title is required.'),
  content: z.string().min(1, 'Content is required.'),
});

interface AnnouncementFormProps {
  currentUser: UserProfile;
  announcement?: Announcement | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AnnouncementForm({ currentUser, announcement, open, onOpenChange }: AnnouncementFormProps) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const isEditing = !!announcement;

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: '',
      content: '',
    },
  });

  useEffect(() => {
    if (open) {
      if (announcement) {
        form.reset({
          title: announcement.title,
          content: announcement.content,
        });
      } else {
        form.reset({
          title: '',
          content: '',
        });
      }
    }
  }, [announcement, open, form]);

  const handleSubmit = async (values: z.infer<typeof formSchema>) => {
    if (!db) return;
    if (!currentUser?.uid || !currentUser?.name) {
      toast({
        variant: 'destructive',
        title: 'Cannot Post Announcement',
        description: 'Your user information is missing. Please try logging out and back in.',
      });
      return;
    }
    
    setIsLoading(true);
    try {
      if (isEditing && announcement) {
        const announcementRef = doc(db, 'announcements', announcement.id);
        await updateDoc(announcementRef, {
          ...values,
          updatedAt: serverTimestamp(),
        });
        toast({ title: 'Success', description: 'Announcement updated.' });
      } else {
        await addDoc(collection(db, 'announcements'), {
          ...values,
          authorName: currentUser.name,
          authorId: currentUser.uid,
          createdAt: serverTimestamp(),
        });
        toast({ title: 'Success', description: 'Announcement created.' });
      }
      onOpenChange(false);
    } catch (error) {
      console.error('Error saving announcement:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'Could not save announcement. Check Firestore rules.' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit' : 'Create'} Announcement</DialogTitle>
          <DialogDescription>
            {isEditing ? 'Make changes to the announcement.' : 'Write a new announcement for the team.'}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4 py-4">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input placeholder="Important Update" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="content"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Content</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Details about the announcement..." rows={6} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>Cancel</Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? <Spinner /> : isEditing ? 'Save Changes' : 'Create Announcement'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
