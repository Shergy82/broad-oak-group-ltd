
'use client';

import { useState, useEffect } from 'react';
import { useUserProfile } from '@/hooks/use-user-profile';
import { db, storage } from '@/lib/firebase';
import { collection, addDoc, serverTimestamp, onSnapshot, query, orderBy, deleteDoc, doc } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/shared/spinner';
import { useToast } from '@/hooks/use-toast';
import { Upload, FileText, Download, Trash2 } from 'lucide-react';
import type { UserProfile, HealthAndSafetyFile } from '@/types';
import { Header } from '@/components/layout/header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/use-auth';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { format } from 'date-fns';
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


function FileUploader({ userProfile }: { userProfile: UserProfile }) {
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();

  const handleFileUpload = (files: FileList | null) => {
    if (!files || files.length === 0 || !db) return;

    setIsUploading(true);

    const uploadPromises = Array.from(files).map(file => {
      const storagePath = `health_and_safety_files/${Date.now()}-${file.name}`;
      const storageRef = ref(storage, storagePath);
      const uploadTask = uploadBytesResumable(storageRef, file);

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
              await addDoc(collection(db, `health_and_safety_files`), {
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
      .then(() => {
        toast({ title: 'Success', description: `${files.length} file(s) uploaded successfully.` });
        const fileInput = document.getElementById('hs-file-upload') as HTMLInputElement;
        if (fileInput) fileInput.value = "";
      })
      .catch((err) => {
        let description = 'One or more files failed to upload. Please try again.';
        if (err?.code?.includes('permission-denied') || err?.code?.includes('unauthorized')) {
            description = "Permission denied. Please check storage & database rules and ensure you are logged in.";
        }
        toast({ variant: 'destructive', title: 'Upload Failed', description, duration: 8000 });
      })
      .finally(() => setIsUploading(false));
  };
  
  return (
    <div className="relative border-2 border-dashed border-muted-foreground/30 rounded-lg p-6 text-center">
        <Upload className="mx-auto h-12 w-12 text-muted-foreground" />
        <h3 className="mt-2 text-sm font-medium text-foreground">
            Click to upload documents
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">or drag and drop files here</p>
        <Input 
            id="hs-file-upload"
            type="file" 
            multiple 
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            onChange={(e) => handleFileUpload(e.target.files)}
            disabled={isUploading}
        />
        {isUploading && (
            <div className="absolute inset-0 bg-background/80 flex items-center justify-center">
                <div className="flex items-center gap-2"><Spinner /> Uploading...</div>
            </div>
        )}
    </div>
  );
}


export default function HealthAndSafetyPage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const { userProfile, loading: isProfileLoading } = useUserProfile();
  const router = useRouter();
  const { toast } = useToast();

  const [files, setFiles] = useState<HealthAndSafetyFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(true);

  // This effect will redirect the user if they are not logged in.
  useEffect(() => {
    if (!isAuthLoading && !user) {
      router.push('/login');
    }
  }, [user, isAuthLoading, router]);

  // This effect fetches the data once the user's profile is loaded.
  useEffect(() => {
    if (!userProfile) {
      return;
    }
    
    const q = query(collection(db, 'health_and_safety_files'), orderBy('uploadedAt', 'desc'));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedFiles = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as HealthAndSafetyFile));
      setFiles(fetchedFiles);
      setFilesLoading(false);
    }, (error) => {
      console.error("Error fetching H&S files:", error);
      toast({
        variant: 'destructive',
        title: 'Error Fetching Files',
        description: 'Could not load the file list. Please check permissions and try again.',
      });
      setFilesLoading(false);
    });

    return () => unsubscribe();
  }, [userProfile, toast]);

  const handleDeleteFile = async (file: HealthAndSafetyFile) => {
    if (!userProfile) return;

    // UI check to ensure only uploader or privileged user can attempt deletion
    const isPrivileged = ['admin', 'owner'].includes(userProfile.role);
    if (userProfile.uid !== file.uploaderId && !isPrivileged) {
        toast({ variant: 'destructive', title: "Permission Denied", description: "You can only delete your own files." });
        return;
    }

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

  const pageIsLoading = isAuthLoading || isProfileLoading;

  if (pageIsLoading) {
    return (
      <div className="flex min-h-screen w-full flex-col items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!user || !userProfile) {
    return null;
  }
  
  return (
    <div className="flex min-h-screen w-full flex-col">
      <Header />
      <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
        <Card>
            <CardHeader>
                <CardTitle>Health &amp; Safety Documents</CardTitle>
                <CardDescription>
                  General Health &amp; Safety documents and resources. All users can upload and download files.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-8">
                <div className="max-w-md mx-auto">
                    <FileUploader userProfile={userProfile} />
                </div>
                
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">Uploaded Documents</h3>
                  {filesLoading ? (
                    <div className="space-y-2">
                      <Skeleton className="h-10 w-full" />
                      <Skeleton className="h-10 w-full" />
                      <Skeleton className="h-10 w-full" />
                    </div>
                  ) : files.length === 0 ? (
                    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
                      <FileText className="mx-auto h-12 w-12 text-muted-foreground" />
                      <h3 className="mt-4 text-lg font-semibold">No Documents Uploaded</h3>
                      <p className="mb-4 mt-2 text-sm text-muted-foreground">
                        Upload documents using the form above.
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
                          {files.map(file => {
                            const canDelete = userProfile.uid === file.uploaderId || ['admin', 'owner'].includes(userProfile.role);
                            return (
                                <TableRow key={file.id}>
                                  <TableCell className="font-medium">{file.name}</TableCell>
                                  <TableCell>{file.uploaderName}</TableCell>
                                  <TableCell>{file.uploadedAt ? format(file.uploadedAt.toDate(), 'dd MMM yyyy') : 'N/A'}</TableCell>
                                  <TableCell>{formatFileSize(file.size)}</TableCell>
                                  <TableCell className="text-right">
                                    <Button variant="ghost" size="icon" asChild>
                                      <a href={file.url} target="_blank" rel="noopener noreferrer" download={file.name}>
                                        <Download className="h-4 w-4" />
                                      </a>
                                    </Button>
                                    {canDelete && (
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
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
            </CardContent>
        </Card>
      </main>
    </div>
  );
}
