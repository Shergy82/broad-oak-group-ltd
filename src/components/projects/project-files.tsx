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
import { FileText, Download, Trash2, Upload, X } from 'lucide-react';
import type { Project, ProjectFile, UserProfile } from '@/types';
import { downloadFile } from '@/file-proxy';
import Image from 'next/image';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';

interface ProjectFilesProps {
  project: Project;
  userProfile: UserProfile;
}

export function ProjectFiles({ project, userProfile }: ProjectFilesProps) {
  const { toast } = useToast();
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [evidenceTag, setEvidenceTag] = useState('');
  const [viewingFile, setViewingFile] = useState<ProjectFile | null>(null);

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
              const fileData: any = {
                name: file.name,
                url: downloadURL,
                fullPath: storagePath,
                size: file.size,
                type: file.type,
                uploadedAt: serverTimestamp(),
                uploaderId: userProfile.uid,
                uploaderName: userProfile.name,
              };

              if (evidenceTag.trim()) {
                fileData.evidenceTag = evidenceTag.trim();
              }

              await addDoc(collection(db, `projects/${project.id}/files`), fileData);
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
        toast({ title: 'Success', description: `${filesToUpload.length} file(s) uploaded successfully.` });
        setEvidenceTag('');
      })
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

  const handleFileClick = (file: ProjectFile) => {
    const isImage = file.type?.startsWith('image/');
    const isPdf = file.type === 'application/pdf';
    const officeExtensions = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'];
    const fileExtension = file.name.split('.').pop()?.toLowerCase() || '';
    const isOfficeDoc = officeExtensions.includes(fileExtension);
    
    if(isImage || isPdf || isOfficeDoc) {
        setViewingFile(file);
    } else {
        downloadFile(file.fullPath);
    }
  };

  const renderFileViewer = () => {
    if (!viewingFile) return null;

    const isImage = viewingFile.type?.startsWith('image/');
    const isPdf = viewingFile.type === 'application/pdf';
    const officeExtensions = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'];
    const fileExtension = viewingFile.name.split('.').pop()?.toLowerCase() || '';
    const isOfficeDoc = officeExtensions.includes(fileExtension);
    
    if (isImage) {
        return <div className="relative w-full h-full"><Image src={`/api/file?path=${encodeURIComponent(viewingFile.fullPath)}`} alt={viewingFile.name} fill className="object-contain" /></div>;
    }

    if (isPdf) {
        const pdfUrl = `/api/file?path=${encodeURIComponent(viewingFile.fullPath)}`;
        return <iframe src={pdfUrl} className="w-full h-full border-0" title={viewingFile.name} />;
    }

    if (isOfficeDoc) {
        const officeUrl = `https://docs.google.com/gview?url=${encodeURIComponent(viewingFile.url)}&embedded=true`;
        return <iframe src={officeUrl} className="w-full h-full border-0" title={viewingFile.name} />;
    }
    
    return <div className="p-8 text-center">Cannot preview this file type.</div>;
  };

  return (
    <>
      <div className="flex flex-col h-full space-y-4">
        <div className="flex-1 min-h-0 flex flex-col space-y-2">
            <h4 className="text-sm font-semibold flex-shrink-0">Attached Files</h4>
            
            {isLoading ? (
              <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
              </div>
            ) : files.length === 0 ? (
              <div className="text-center text-muted-foreground p-4 border-dashed border rounded-lg flex-1 flex flex-col justify-center min-h-[100px]">
                <FileText className="mx-auto h-8 w-8 text-muted-foreground/50" />
                <p className="mt-2 text-xs">No files attached yet.</p>
              </div>
            ) : (
              <div className="border rounded-lg overflow-hidden flex flex-col flex-1 min-h-[150px] max-h-[220px]">
                  <ScrollArea className="flex-1">
                    <Table>
                        <TableHeader className="sticky top-0 bg-background z-10">
                            <TableRow className="hover:bg-transparent">
                                <TableHead className="h-8 text-[10px] uppercase font-bold">File</TableHead>
                                <TableHead className="h-8 text-right text-[10px] uppercase font-bold">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                        {files.map(file => (
                            <TableRow key={file.id} className="h-12">
                                <TableCell className="py-1 font-medium truncate max-w-[120px]">
                                    <button onClick={() => handleFileClick(file)} className="hover:underline text-left truncate block w-full text-xs font-semibold" title={file.name}>
                                        {file.name}
                                    </button>
                                    <p className="text-[9px] text-muted-foreground truncate">{formatFileSize(file.size)} • {file.uploaderName.split(' ')[0]}</p>
                                </TableCell>
                                <TableCell className="py-1 text-right space-x-0.5">
                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => downloadFile(file.fullPath)}>
                                        <Download className="h-3.5 w-3.5" />
                                    </Button>
                                    {(userProfile.uid === file.uploaderId || ['admin', 'owner', 'manager', 'TLO'].includes(userProfile.role)) && (
                                        <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive/70 hover:text-destructive hover:bg-destructive/10">
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </Button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent>
                                                <AlertDialogHeader>
                                                    <AlertDialogTitle className="text-base">Delete File?</AlertDialogTitle>
                                                    <AlertDialogDescription className="text-sm">This action cannot be undone.</AlertDialogDescription>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter className="flex-row gap-2">
                                                    <AlertDialogCancel className="mt-0 flex-1">Cancel</AlertDialogCancel>
                                                    <AlertDialogAction onClick={() => handleDeleteFile(file)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90 flex-1">Delete</AlertDialogAction>
                                                </AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                    )}
                                </TableCell>
                            </TableRow>
                        ))}
                        </TableBody>
                    </Table>
                  </ScrollArea>
              </div>
            )}
        </div>

        <div className="flex-shrink-0 pt-2 space-y-3 border-t">
          <div className="space-y-1.5 text-left">
              <Label htmlFor={`evidence-tag-user-${project.id}`} className="text-[11px] font-bold uppercase text-muted-foreground">Evidence Tag (Optional)</Label>
              <Input 
                  id={`evidence-tag-user-${project.id}`}
                  placeholder="e.g., boiler-photo"
                  value={evidenceTag}
                  onChange={(e) => setEvidenceTag(e.target.value)}
                  className="bg-background h-8 text-xs"
              />
          </div>

          <Input
            id={`file-upload-user-${project.id}`}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => handleFileUpload(e.target.files)}
            disabled={isUploading}
          />
          <Button asChild className="w-full h-9 shadow-sm" disabled={isUploading} variant="outline" size="sm">
            <Label htmlFor={`file-upload-user-${project.id}`} className="cursor-pointer w-full flex items-center justify-center font-bold">
              {isUploading ? (
                <>
                  <Spinner size="sm" className="mr-2" /> Uploading...
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
      <Dialog open={!!viewingFile} onOpenChange={() => setViewingFile(null)}>
        <DialogContent className="max-w-[95vw] h-[85vh] p-2 flex flex-col sm:max-w-[90vw]">
            <DialogHeader className="p-2 border-b flex-shrink-0">
                <DialogTitle className="truncate text-base">{viewingFile?.name}</DialogTitle>
            </DialogHeader>
            <div className="flex-grow relative bg-muted/20 overflow-hidden rounded-md">
                {renderFileViewer()}
            </div>
        </DialogContent>
      </Dialog>
    </>
  );
}