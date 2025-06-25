'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { db, storage } from '@/lib/firebase';
import { collection, addDoc, onSnapshot, query, orderBy, Timestamp, doc, deleteDoc } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { FileText, Upload, Download, Trash2 } from 'lucide-react';
import type { Project, ProjectFile } from '@/types';

interface ProjectFilesProps {
  project: Project;
}

export function ProjectFiles({ project }: ProjectFilesProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  useEffect(() => {
    if (!db || !project) return;
    const filesQuery = query(collection(db, `projects/${project.id}/files`), orderBy('uploadedAt', 'desc'));
    const unsubscribe = onSnapshot(filesQuery, (snapshot) => {
      const fetchedFiles = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ProjectFile));
      setFiles(fetchedFiles);
      setIsLoading(false);
    }, (error) => {
      console.error("Error fetching project files:", error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Could not fetch project files. Check permissions.',
      });
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [project, toast]);
  
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
    }
  };
  
  const handleUpload = async () => {
    if (!selectedFile || !storage || !db || !user) {
      toast({ variant: 'destructive', title: 'Upload Failed', description: 'Please select a file to upload.' });
      return;
    }
    
    setUploadProgress(0);
    const storageRef = ref(storage, `projects/${project.id}/${Date.now()}_${selectedFile.name}`);
    const uploadTask = uploadBytesResumable(storageRef, selectedFile);
    
    uploadTask.on('state_changed',
      (snapshot) => {
        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        setUploadProgress(progress);
      },
      (error) => {
        console.error("Upload error:", error);
        toast({ variant: 'destructive', title: 'Upload Failed', description: 'An error occurred during upload. Please try again.' });
        setUploadProgress(null);
        setSelectedFile(null);
      },
      async () => {
        const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
        await addDoc(collection(db, `projects/${project.id}/files`), {
          name: selectedFile.name,
          url: downloadURL,
          path: uploadTask.snapshot.ref.fullPath,
          size: selectedFile.size,
          type: selectedFile.type,
          uploadedAt: Timestamp.now(),
        });

        toast({ title: 'Upload Complete', description: `'${selectedFile.name}' has been attached to the project.` });
        setUploadProgress(null);
        setSelectedFile(null);
        setIsDialogOpen(false);
      }
    );
  };
  
  const handleDelete = async (file: ProjectFile) => {
    if (!storage || !db || !confirm(`Are you sure you want to delete '${file.name}'? This cannot be undone.`)) {
      return;
    }
    
    const fileStorageRef = ref(storage, file.path);
    const fileDocRef = doc(db, `projects/${project.id}/files`, file.id);

    try {
      await deleteObject(fileStorageRef);
      await deleteDoc(fileDocRef);
      toast({ title: 'File Deleted', description: `'${file.name}' was successfully deleted.` });
    } catch (error) {
      console.error("Delete error:", error);
      toast({ variant: 'destructive', title: 'Delete Failed', description: 'Could not delete the file. Please try again.' });
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h4 className="text-sm font-semibold">Attached Files</h4>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline">
              <Upload className="mr-2 h-4 w-4" />
              Attach File
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Attach a New File</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <Input type="file" onChange={handleFileSelect} disabled={uploadProgress !== null} />
              {uploadProgress !== null && <Progress value={uploadProgress} className="w-full" />}
              <Button onClick={handleUpload} disabled={!selectedFile || uploadProgress !== null} className="w-full">
                {uploadProgress !== null ? 'Uploading...' : 'Upload'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      
      {isLoading ? (
        <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
        </div>
      ) : files.length === 0 ? (
        <div className="text-center text-muted-foreground p-4 border-dashed border rounded-lg">
          <FileText className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-2 text-sm">No files have been attached to this project yet.</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>File Name</TableHead>
                        <TableHead className="w-[100px] text-right">Size</TableHead>
                        <TableHead className="w-[120px] text-right">Actions</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                {files.map(file => (
                    <TableRow key={file.id}>
                        <TableCell className="font-medium truncate max-w-[200px]">{file.name}</TableCell>
                        <TableCell className="text-right text-muted-foreground text-xs">{formatFileSize(file.size)}</TableCell>
                        <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                                <a href={file.url} target="_blank" rel="noopener noreferrer" download={file.name}>
                                    <Button variant="ghost" size="icon" className="h-8 w-8">
                                        <Download className="h-4 w-4" />
                                    </Button>
                                </a>
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDelete(file)}>
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                            </div>
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
