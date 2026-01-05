
'use client';

import { useState, useEffect } from 'react';
import { collection, onSnapshot, query, orderBy, doc, deleteDoc } from 'firebase/firestore';
import { ref, deleteObject } from 'firebase/storage';
import { db, storage } from '@/lib/firebase';
import type { HealthAndSafetyFile, UserProfile } from '@/types';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Download, Trash2, FileText } from 'lucide-react';
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
} from "@/components/ui/alert-dialog";

interface HealthAndSafetyFileListProps {
  userProfile: UserProfile;
}

export function HealthAndSafetyFileList({ userProfile }: HealthAndSafetyFileListProps) {
  const [files, setFiles] = useState<HealthAndSafetyFile[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const isOwner = userProfile.role === 'owner';

  useEffect(() => {
    const q = query(collection(db, 'health_and_safety_files'), orderBy('uploadedAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedFiles = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as HealthAndSafetyFile));
      setFiles(fetchedFiles);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching H&S files:", error);
      toast({
        variant: 'destructive',
        title: 'Error Fetching Files',
        description: 'Could not load the file list. Please check permissions and try again.',
      });
      setLoading(false);
    });

    return () => unsubscribe();
  }, [toast]);

  const handleDeleteFile = async (file: HealthAndSafetyFile) => {
    try {
      const fileRef = ref(storage, file.fullPath);
      await deleteObject(fileRef);
      await deleteDoc(doc(db, 'health_and_safety_files', file.id));
      toast({ title: "File Deleted", description: `Successfully deleted ${file.name}.` });
    } catch (error) {
      console.error("Error deleting file:", error);
      toast({ variant: 'destructive', title: "Error", description: "Could not delete file." });
    }
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  if (loading) {
    return (
      <div className="space-y-2 mt-8">
        <h3 className="text-lg font-semibold">Uploaded Documents</h3>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4 mt-8">
      <h3 className="text-lg font-semibold">Uploaded Documents</h3>
      {files.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <FileText className="mx-auto h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-semibold">No Documents Uploaded</h3>
          <p className="mb-4 mt-2 text-sm text-muted-foreground">
            The owner can upload documents using the form above.
          </p>
        </div>
      ) : (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File Name</TableHead>
                <TableHead>Uploaded By</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Size</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {files.map(file => (
                <TableRow key={file.id}>
                  <TableCell className="font-medium">{file.name}</TableCell>
                  <TableCell>{file.uploaderName}</TableCell>
                  <TableCell>{format(file.uploadedAt.toDate(), 'dd MMM yyyy')}</TableCell>
                  <TableCell>{formatFileSize(file.size)}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" asChild>
                      <a href={file.url} target="_blank" rel="noopener noreferrer" download={file.name}>
                        <Download className="h-4 w-4" />
                      </a>
                    </Button>
                    {isOwner && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="text-destructive/70 hover:text-destructive hover:bg-destructive/10">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                            <AlertDialogDescription>This will permanently delete the file "{file.name}". This action cannot be undone.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleDeleteFile(file)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
