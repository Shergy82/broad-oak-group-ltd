
'use client';

import { useState, useEffect, useMemo } from 'react';
import { useUserProfile } from '@/hooks/use-user-profile';
import { db, storage } from '@/lib/firebase';
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
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { useToast } from '@/hooks/use-toast';
import { Upload, File as FileIcon, Trash2, Download, HardHat } from 'lucide-react';
import type { HealthAndSafetyFile, UserProfile } from '@/types';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Header } from '@/components/layout/header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/use-auth';
import { useRouter } from 'next/navigation';

function FileUploader({ userProfile, onUploadComplete }: { userProfile: UserProfile, onUploadComplete: () => void }) {
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();

  const handleFileUpload = (files: FileList | null) => {
    if (!files || files.length === 0) return;
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
        onUploadComplete();
      })
      .catch(() => toast({ variant: 'destructive', title: 'Upload Failed', description: 'One or more files failed to upload. Please try again.' }))
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

  const [files, setFiles] = useState<HealthAndSafetyFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const { toast } = useToast();

  const isPrivilegedUser = userProfile && ['admin', 'owner'].includes(userProfile.role);

  useEffect(() => {
    if (!isAuthLoading && !user) {
      router.push('/login');
    }
  }, [user, isAuthLoading, router]);
  
  useEffect(() => {
    const q = query(collection(db, 'health_and_safety_files'), orderBy('uploadedAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setFiles(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as HealthAndSafetyFile)));
      setLoading(false);
    }, (error: any) => {
      console.error("Error fetching H&S files:", error);
      let description = 'Could not fetch Health & Safety files.';
      if (error.code === 'permission-denied') {
        description = "You don't have permission to view these files. Please check the `firestore.rules` file.";
      } else if (error.code === 'failed-precondition') {
        description = 'A database index is required. Please check the `firestore.indexes.json` file.';
      }
      toast({ variant: 'destructive', title: 'Error', description, duration: 10000 });
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
    if (bytes === undefined || bytes === null) return 'N/A';
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const filteredFiles = useMemo(() => {
    return files.filter(file =>
      file.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      file.uploaderName.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [files, searchTerm]);
  
  const isLoadingPage = isAuthLoading || isProfileLoading;
  
  if (isLoadingPage && !userProfile) {
    return (
      <div className="flex min-h-screen w-full flex-col items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full flex-col">
      <Header />
      <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
        <Card>
            <CardHeader>
                <CardTitle>Health & Safety Documents</CardTitle>
                <CardDescription>General Health & Safety documents and resources. Admins can upload new files.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-2 space-y-4">
                        <Input
                            placeholder="Search files..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="max-w-sm"
                        />
                        <div className="border rounded-lg">
                            {loading ? <Skeleton className="h-72 w-full" /> : (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                    <TableHead>File Name</TableHead>
                                    <TableHead>Uploaded By</TableHead>
                                    <TableHead>Date</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredFiles.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={4} className="h-24 text-center">
                                                No documents found.
                                            </TableCell>
                                        </TableRow>
                                    ) : filteredFiles.map(file => (
                                        <TableRow key={file.id}>
                                            <TableCell className="font-medium truncate max-w-[200px]" title={file.name}>
                                                <a href={file.url} target="_blank" rel="noopener noreferrer" className="hover:underline flex items-center gap-2">
                                                    <FileIcon className="h-4 w-4 text-muted-foreground" />
                                                    {file.name}
                                                </a>
                                                <p className="text-xs text-muted-foreground pl-6">{formatFileSize(file.size)}</p>
                                            </TableCell>
                                            <TableCell>{file.uploaderName}</TableCell>
                                            <TableCell>{file.uploadedAt ? format(file.uploadedAt.toDate(), 'dd/MM/yyyy') : 'N/A'}</TableCell>
                                            <TableCell className="text-right">
                                                <a href={file.url} target="_blank" rel="noopener noreferrer" download={file.name}>
                                                    <Button variant="ghost" size="icon" className="h-8 w-8">
                                                        <Download className="h-4 w-4" />
                                                    </Button>
                                                </a>
                                                {isPrivilegedUser && (
                                                    <AlertDialog>
                                                        <AlertDialogTrigger asChild>
                                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive/70 hover:text-destructive hover:bg-destructive/10">
                                                                <Trash2 className="h-4 w-4" />
                                                            </Button>
                                                        </AlertDialogTrigger>
                                                        <AlertDialogContent>
                                                            <AlertDialogHeader>
                                                                <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                                                <AlertDialogDescription>This will permanently delete the file <span className="font-semibold">{file.name}</span>.</AlertDialogDescription>
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
                            )}
                        </div>
                    </div>
                    {isPrivilegedUser && userProfile && (
                        <div className="space-y-4">
                            <h3 className="text-lg font-semibold text-center md:text-left">Upload Documents</h3>
                            <FileUploader userProfile={userProfile} onUploadComplete={() => {
                                const fileInput = document.getElementById('hs-file-upload') as HTMLInputElement;
                                if (fileInput) fileInput.value = "";
                            }} />
                        </div>
                    )}
                </div>
                 {filteredFiles.length === 0 && !loading && !isPrivilegedUser && (
                    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center lg:col-span-3">
                        <HardHat className="mx-auto h-12 w-12 text-muted-foreground" />
                        <h3 className="mt-4 text-lg font-semibold">No Documents Available</h3>
                        <p className="mb-4 mt-2 text-sm text-muted-foreground">
                            No Health & Safety documents have been uploaded yet.
                        </p>
                    </div>
                )}
            </CardContent>
        </Card>
      </main>
    </div>
  );
}
