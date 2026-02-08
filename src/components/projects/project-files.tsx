'use client';

import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { db, storage, functions, httpsCallable } from '@/lib/firebase';
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  addDoc,
  deleteDoc,
  doc,
  serverTimestamp,
} from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/shared/spinner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
} from "@/components/ui/alert-dialog"
import { FileText, Download, Trash2, Upload } from 'lucide-react';
import type { Project, ProjectFile, UserProfile } from '@/types';
import { downloadFile } from '@/file-proxy';

interface ProjectFilesProps {
  project: Project;
  userProfile: UserProfile;
}

export function ProjectFiles({ project, userProfile }: ProjectFilesProps) {
  const { toast } = useToast();
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);

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
        description: 'Could not fetch project files. Please check permissions.',
      });
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [project, toast]);

  const handleFileUpload = (selectedFiles: FileList | null) => {
    if (!selectedFiles || selectedFiles.length === 0) return;
    
    setIsUploading(true);

    const filesToUpload = Array.from(selectedFiles);

    const uploadPromises = filesToUpload.map(file => {
      const storagePath = `project_files/${project.id}/${Date.now()}-${file.name}`;
      const storageRef = ref(storage, storagePath);
      const metadata = {
        contentDisposition: 'attachment',
      };
      const uploadTask = uploadBytesResumable(storageRef, file, metadata);

      return new Promise<void>((resolve, reject) => {
        uploadTask.on(
          'state_changed',
          null,
          (error) => {
            console.error(`Upload failed for ${file.name}:`, error);
            reject(error);
          },
          async () => {
            try {
              const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
              await addDoc(collection(db, `projects/${project.id}/files`), {
                name: file.name,
                url: downloadURL,
                fullPath: storagePath,
                size: file.size,
                type: file.type,
                uploadedAt: serverTimestamp(),
                uploaderId: userProfile.uid,
                uploaderName: userProfile.name,
              });
              resolve();
            } catch (dbError) {
              console.error(`Failed to save file info for ${file.name} to Firestore:`, dbError);
              reject(dbError);
            }
          }
        );
      });
    });

    Promise.all(uploadPromises)
      .then(() => toast({ title: 'Success', description: `${filesToUpload.length} file(s) uploaded successfully.` }))
      .catch(() => toast({ variant: 'destructive', title: 'Upload Failed', description: 'One or more files failed to upload. Please check your project permissions and try again.' }))
      .finally(() => {
          setIsUploading(false);
          const fileInput = document.getElementById(`file-upload-user-${project.id}`) as HTMLInputElement;
          if (fileInput) {
              fileInput.value = "";
          }
      });
  };
  
  const handleDeleteFile = async (file: ProjectFile) => {
    if (!project || !functions) {
        toast({ variant: 'destructive', title: 'Error', description: 'Required services are not available.' });
        return;
    }
    try {
        const deleteProjectFileFn = httpsCallable(functions, 'deleteProjectFile');
        await deleteProjectFileFn({ projectId: project.id, fileId: file.id });
        toast({ title: "File Deleted", description: `Successfully deleted ${file.name}.` });
    } catch (error: any) {
        console.error("Error deleting file:", error);
        toast({ variant: 'destructive', title: "Error", description: error.message || "Could not delete file." });
    }
  };


  const formatFileSize = (bytes?: number) => {
    if (bytes === undefined || bytes === null) return 'N/A';
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getFileViewUrl = (file: ProjectFile): string => {
    const officeExtensions = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'];
    const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'];
    const fileExtension = file.name.split('.').pop()?.toLowerCase();

    if (fileExtension) {
        if (officeExtensions.includes(fileExtension) || fileExtension === 'pdf') {
            return `https://docs.google.com/gview?url=${encodeURIComponent(file.url)}&embedded=true`;
        }
        if (imageExtensions.includes(fileExtension)) {
            // Using an image proxy to bypass content-disposition header
            return `https://images.weserv.nl/?url=${encodeURIComponent(file.url)}`;
        }
    }
    return file.url;
  };


  return (
    <div className="space-y-4">
      <h4 className="text-sm font-semibold">Attached Files</h4>
      
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
        <div className="border rounded-lg overflow-hidden max-h-60 overflow-y-auto">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>File</TableHead>
                        <TableHead>Uploaded by</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                {files.map(file => (
                    <TableRow key={file.id}>
                        <TableCell className="font-medium truncate max-w-[150px]">
                            <a href={getFileViewUrl(file)} target="_blank" rel="noopener noreferrer" className="hover:underline" title={file.name}>
                              {file.name}
                            </a>
                            <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{file.uploaderName}</TableCell>
                        <TableCell className="text-right space-x-1">
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => downloadFile(file.fullPath)}>
                                <Download className="h-4 w-4" />
                            </Button>
                            {(userProfile.uid === file.uploaderId || ['admin', 'owner'].includes(userProfile.role)) && (
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive/70 hover:text-destructive hover:bg-destructive/10">
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                            <AlertDialogDescription>This will permanently delete "{file.name}".</AlertDialogDescription>
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
      <div className="pt-2">
        <Input
          id={`file-upload-user-${project.id}`}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => handleFileUpload(e.target.files)}
          disabled={isUploading}
        />
        <Button asChild className="w-full" disabled={isUploading}>
          <Label htmlFor={`file-upload-user-${project.id}`} className="cursor-pointer w-full">
            {isUploading ? (
              <>
                <Spinner /> Uploading...
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" /> Upload File
              </>
            )}
          </Label>
        </Button>
      </div>
    </div>
  );
}
