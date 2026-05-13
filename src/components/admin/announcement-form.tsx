'use client';

import { useState, useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { db, storage } from '@/lib/firebase';
import { collection, addDoc, updateDoc, doc, serverTimestamp, deleteField } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Spinner } from '@/components/shared/spinner';
import type { Announcement, UserProfile } from '@/types';
import { useAllUsers } from '@/hooks/use-all-users';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FileIcon, ImageIcon, X, Paperclip } from 'lucide-react';
import { Label } from '../ui/label';

const formSchema = z.object({
  title: z.string().min(1, 'Title is required.'),
  content: z.string().min(1, 'Content is required.'),
  department: z.string().optional(),
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
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [existingFile, setExistingFile] = useState<{ url: string, name: string, type: string, path: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const isEditing = !!announcement;
  const { users: allUsers } = useAllUsers();

  const availableDepartments = Array.from(new Set(allUsers.map(u => u.department).filter(Boolean))).sort() as string[];

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: '',
      content: '',
      department: 'all',
    },
  });

  useEffect(() => {
    if (open) {
      if (announcement) {
        form.reset({
          title: announcement.title,
          content: announcement.content,
          department: announcement.department || 'all',
        });
        if (announcement.fileUrl) {
            setExistingFile({
                url: announcement.fileUrl,
                name: announcement.fileName || 'file',
                type: announcement.fileType || '',
                path: announcement.fileStoragePath || ''
            });
        } else {
            setExistingFile(null);
        }
      } else {
        form.reset({
          title: '',
          content: '',
          department: 'all',
        });
        setExistingFile(null);
      }
      setFile(null);
      setFilePreview(null);
    }
  }, [announcement, open, form]);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
        setFile(selected);
        if (selected.type.startsWith('image/')) {
            setFilePreview(URL.createObjectURL(selected));
        } else {
            setFilePreview(null);
        }
        setExistingFile(null);
    }
  };

  const removeFile = () => {
    setFile(null);
    setFilePreview(null);
    setExistingFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

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
      const dataToSave: any = {
        title: values.title,
        content: values.content,
        department: values.department === 'all' ? deleteField() : values.department,
      };

      let announcementRef;
      if (isEditing && announcement) {
        announcementRef = doc(db, 'announcements', announcement.id);
        await updateDoc(announcementRef, {
          ...dataToSave,
          updatedAt: serverTimestamp(),
        });
      } else {
        const docRef = await addDoc(collection(db, 'announcements'), {
          ...dataToSave,
          authorName: currentUser.name,
          authorId: currentUser.uid,
          createdAt: serverTimestamp(),
        });
        announcementRef = docRef;
      }

      // Handle File Upload
      if (file) {
          const storagePath = `announcements/${announcementRef.id}/${file.name}`;
          const storageRef = ref(storage, storagePath);
          await uploadBytesResumable(storageRef, file);
          const downloadURL = await getDownloadURL(storageRef);
          
          await updateDoc(announcementRef, {
              fileUrl: downloadURL,
              fileName: file.name,
              fileType: file.type,
              fileStoragePath: storagePath
          });
      } else if (!existingFile) {
          // File was removed
          await updateDoc(announcementRef, {
              fileUrl: deleteField(),
              fileName: deleteField(),
              fileType: deleteField(),
              fileStoragePath: deleteField()
          });
      }

      toast({ title: 'Success', description: `Announcement ${isEditing ? 'updated' : 'created'}.` });
      onOpenChange(false);
    } catch (error) {
      console.error('Error saving announcement:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'Could not save announcement.' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="department"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Department Visibility</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                            <SelectTrigger>
                                <SelectValue placeholder="Select a department..." />
                            </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                            <SelectItem value="all">All Departments (Global)</SelectItem>
                            {availableDepartments.map(dept => (
                                <SelectItem key={dept} value={dept}>{dept}</SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <div className="space-y-2">
                    <FormLabel>Attach Photo or File</FormLabel>
                    <div className="flex items-center gap-2">
                        <Input 
                            type="file" 
                            className="hidden" 
                            id="announcement-file" 
                            onChange={onFileChange}
                            ref={fileInputRef}
                        />
                        <Button 
                            type="button" 
                            variant="outline" 
                            className="w-full justify-start"
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <Paperclip className="mr-2 h-4 w-4" />
                            {file ? 'Change File' : existingFile ? 'Change File' : 'Select File'}
                        </Button>
                    </div>
                </div>
            </div>

            {(filePreview || (existingFile && existingFile.type.startsWith('image/'))) && (
                <div className="relative mt-2 rounded-lg border overflow-hidden bg-muted/20 flex justify-center p-2">
                    <img 
                        src={filePreview || existingFile?.url} 
                        alt="Preview" 
                        className="max-h-40 w-auto rounded"
                    />
                    <Button 
                        type="button" 
                        variant="destructive" 
                        size="icon" 
                        className="absolute top-1 right-1 h-6 w-6 rounded-full"
                        onClick={removeFile}
                    >
                        <X className="h-4 w-4" />
                    </Button>
                </div>
            )}
            
            {((file && !file.type.startsWith('image/')) || (existingFile && !existingFile.type.startsWith('image/'))) && (
                <div className="flex items-center justify-between p-2 rounded-lg border bg-muted/20">
                    <div className="flex items-center gap-2">
                        <FileIcon className="h-5 w-5 text-muted-foreground" />
                        <span className="text-sm font-medium truncate max-w-[200px]">
                            {file?.name || existingFile?.name}
                        </span>
                    </div>
                    <Button 
                        type="button" 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 text-destructive"
                        onClick={removeFile}
                    >
                        <X className="h-4 w-4" />
                    </Button>
                </div>
            )}

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
