

'use client';

import { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, query, orderBy, doc, deleteDoc, writeBatch, getDocs, where, deleteField } from 'firebase/firestore';
import { ref, deleteObject } from 'firebase/storage';
import { db, storage } from '@/lib/firebase';
import type { HealthAndSafetyFile, UserProfile } from '@/types';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Download, Trash2, Folder, FolderPlus, FolderCog, FolderX, X } from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/shared/spinner';
import { FileUploader } from './file-uploader';
import { downloadFile } from '@/file-proxy';
import Image from 'next/image';
import { Separator } from '../ui/separator';

interface HealthAndSafetyFileListProps {
  userProfile: UserProfile;
}

export function HealthAndSafetyFileList({ userProfile }: HealthAndSafetyFileListProps) {
  const [files, setFiles] = useState<HealthAndSafetyFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFolderCreating, setIsFolderCreating] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [emptyFolders, setEmptyFolders] = useState<string[]>([]);

  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [newRenamedFolder, setNewRenamedFolder] = useState('');
  
  const [deletingFolder, setDeletingFolder] = useState<string | null>(null);
  const [viewingFile, setViewingFile] = useState<HealthAndSafetyFile | null>(null);

  const { toast } = useToast();
  const isPrivilegedUser = ['admin', 'owner', 'manager'].includes(userProfile.role);

  useEffect(() => {
    const q = query(collection(db, 'health_and_safety_files'), orderBy('uploadedAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedFiles = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as HealthAndSafetyFile));
      setFiles(fetchedFiles);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching H&S files:", error);
      toast({ variant: 'destructive', title: 'Error Fetching Files', description: 'Could not load the file list. Please check permissions and try again.' });
      setLoading(false);
    });
    return () => unsubscribe();
  }, [toast]);
  
  const { folders, uncategorizedFiles } = useMemo(() => {
    const folderMap = new Map<string, HealthAndSafetyFile[]>();
    const uncategorized: HealthAndSafetyFile[] = [];

    emptyFolders.forEach(folderName => {
        if (!folderMap.has(folderName)) {
            folderMap.set(folderName, []);
        }
    });

    files.forEach(file => {
      if (file.folder) {
        if (!folderMap.has(file.folder)) {
          folderMap.set(file.folder, []);
        }
        folderMap.get(file.folder)!.push(file);
      } else {
        uncategorized.push(file);
      }
    });

    const sortedFolders = Array.from(folderMap.entries()).sort(([a], [b]) => a.localeCompare(b));
    return { folders: sortedFolders, uncategorizedFiles: uncategorized };
  }, [files, emptyFolders]);
  
  const allFolderNames = useMemo(() => {
    const names = new Set<string>();
    files.forEach(file => {
        if (file.folder) names.add(file.folder);
    });
    emptyFolders.forEach(name => names.add(name));
    return names;
  }, [files, emptyFolders]);

  const handleDeleteFile = async (file: HealthAndSafetyFile) => {
    try {
      if(file.fullPath) {
        const fileRef = ref(storage, file.fullPath);
        await deleteObject(fileRef);
      }
      await deleteDoc(doc(db, 'health_and_safety_files', file.id));
      toast({ title: "File Deleted", description: `Successfully deleted ${file.name}.` });
    } catch (error) {
      console.error("Error deleting file:", error);
      toast({ variant: 'destructive', title: "Error", description: "Could not delete file." });
    }
  };
  
  const handleFileClick = (file: HealthAndSafetyFile) => {
    window.open(file.url, '_blank', 'noopener,noreferrer');
  };

  const handleCreateFolder = () => {
    const trimmedName = newFolderName.trim();
    if (!trimmedName) {
      toast({ variant: 'destructive', title: 'Folder name cannot be empty.' });
      return;
    }
    if (allFolderNames.has(trimmedName)) {
      toast({ variant: 'destructive', title: 'Folder already exists.' });
      return;
    }
    setEmptyFolders(prev => [...prev, trimmedName]);
    toast({ title: 'Folder Created', description: `Folder "${trimmedName}" is ready for files.`});
    setIsFolderCreating(false);
    setNewFolderName('');
  };

  const handleRenameFolder = async () => {
    if (!renamingFolder || !newRenamedFolder.trim()) return;
    const oldName = renamingFolder;
    const newName = newRenamedFolder.trim();

    if (!files.some(f => f.folder === oldName)) {
        setEmptyFolders(prev => [...prev.filter(f => f !== oldName), newName]);
        setRenamingFolder(null);
        setNewRenamedFolder('');
        toast({ title: 'Success!', description: `Folder renamed.` });
        return;
    }

    toast({ title: "Renaming folder...", description: "Please wait." });
    try {
        const q = query(collection(db, 'health_and_safety_files'), where('folder', '==', oldName));
        const snapshot = await getDocs(q);
        
        if (snapshot.empty) {
            toast({ variant: 'destructive', title: 'Folder is empty or does not exist.' });
            return;
        }
        
        const batch = writeBatch(db);
        snapshot.docs.forEach(document => {
            batch.update(doc(db, 'health_and_safety_files', document.id), { folder: newName });
        });

        await batch.commit();
        toast({ title: 'Success!', description: `Folder "${oldName}" was renamed to "${newName}".` });
    } catch (error) {
        console.error("Error renaming folder:", error);
        toast({ variant: 'destructive', title: 'Error', description: "Could not rename folder." });
    } finally {
        setRenamingFolder(null);
        setNewRenamedFolder('');
    }
  };
  
  const handleDeleteFolder = async (folderNameToDelete: string) => {
    if (!folderNameToDelete || deletingFolder) return;

    setDeletingFolder(folderNameToDelete);
    toast({ title: `Deleting "${folderNameToDelete}"...`, description: "This will delete the folder and all its contents." });
    
    try {
      const q = query(collection(db, 'health_and_safety_files'), where('folder', '==', folderNameToDelete));
      const snapshot = await getDocs(q);
      
      if (!snapshot.empty) {
          const batch = writeBatch(db);
          const storageDeletePromises: Promise<void>[] = [];

          snapshot.docs.forEach(document => {
              const file = document.data() as HealthAndSafetyFile;
              if (file.fullPath) {
                  const fileRef = ref(storage, file.fullPath);
                  storageDeletePromises.push(deleteObject(fileRef).catch(e => console.warn(`Failed to delete storage file ${file.fullPath}`, e))); // non-blocking
              }
              batch.delete(document.ref);
          });

          await Promise.all(storageDeletePromises);
          await batch.commit();
      }

      setEmptyFolders(prev => prev.filter(f => f !== folderNameToDelete));

      toast({ title: 'Success!', description: `Folder "${folderNameToDelete}" and all its files were deleted.` });
    } catch (error) {
      console.error("Error deleting folder and its contents:", error);
      toast({ variant: 'destructive', title: 'Error', description: "Could not delete the folder and its contents." });
    } finally {
      setDeletingFolder(null);
    }
  };


  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const renderFileList = (filesToList: HealthAndSafetyFile[]) => {
    if (filesToList.length === 0) {
      return <p className="text-sm text-center text-muted-foreground p-4">This folder is empty.</p>
    }
    return (
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
            {filesToList.map(file => (
              <TableRow key={file.id}>
                <TableCell className="font-medium truncate max-w-[200px]">
                    <button onClick={() => handleFileClick(file)} className="hover:underline text-left truncate block w-full" title={file.name}>
                        {file.name}
                    </button>
                </TableCell>
                <TableCell>{file.uploaderName}</TableCell>
                <TableCell>{file.uploadedAt ? format(file.uploadedAt.toDate(), 'dd MMM yyyy') : 'Just now'}</TableCell>
                <TableCell>{formatFileSize(file.size)}</TableCell>
                <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => downloadFile(file.fullPath)}>
                        <Download className="h-4 w-4" />
                    </Button>
                  {isPrivilegedUser && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="text-destructive/70 hover:text-destructive hover:bg-destructive/10">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader><AlertDialogTitle>Are you sure?</AlertDialogTitle><AlertDialogDescription>This will permanently delete the file "{file.name}".</AlertDialogDescription></AlertDialogHeader>
                        <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => handleDeleteFile(file)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction></AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-2 mt-8">
        <h3 className="text-lg font-semibold">Uploaded Documents</h3>
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <>
    <div className="space-y-8">
        {isPrivilegedUser && (
            <div className='space-y-4'>
                <div className="flex justify-between items-center">
                    <h2 className="text-xl font-semibold">Upload Files</h2>
                    <Button onClick={() => setIsFolderCreating(true)}>
                        <FolderPlus className="mr-2 h-4 w-4" /> Create Folder
                    </Button>
                </div>
                <FileUploader userProfile={userProfile} />
            </div>
        )}
        
        {(uncategorizedFiles.length > 0 || folders.length > 0) && <Separator />}

        {uncategorizedFiles.length > 0 && (
            <div className="space-y-4">
                <h2 className="text-xl font-semibold">General Files</h2>
                {renderFileList(uncategorizedFiles)}
            </div>
        )}

        <Accordion type="multiple" className="w-full" defaultValue={folders.map(([name]) => name)}>
            {folders.map(([folderName, folderFiles]) => (
                <AccordionItem key={folderName} value={folderName}>
                    <AccordionTrigger>
                        <div className="flex items-center gap-2 text-lg font-semibold">
                            <Folder /> {folderName} <span className="text-sm font-normal text-muted-foreground">({folderFiles.length})</span>
                        </div>
                    </AccordionTrigger>
                    <AccordionContent className="p-4 bg-muted/50 rounded-b-md space-y-4">
                        {isPrivilegedUser && (
                            <div className="flex justify-end gap-2">
                                <Button size="sm" variant="outline" onClick={() => setRenamingFolder(folderName)}><FolderCog className="mr-2 h-4 w-4" />Rename</Button>
                                <AlertDialog>
                                    <AlertDialogTrigger asChild><Button size="sm" variant="destructive"><FolderX className="mr-2 h-4 w-4" />Delete</Button></AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader><AlertDialogTitle>Delete Folder?</AlertDialogTitle><AlertDialogDescription>This will permanently delete the folder "{folderName}" and all files contained within it. This action cannot be undone.</AlertDialogDescription></AlertDialogHeader>
                                        <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => handleDeleteFolder(folderNameToDelete)} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground" disabled={deletingFolder === folderName}>
                                            {deletingFolder === folderName ? <Spinner /> : 'Delete Folder'}
                                        </AlertDialogAction></AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            </div>
                        )}
                        {renderFileList(folderFiles)}
                        {isPrivilegedUser && <FileUploader userProfile={userProfile} folder={folderName} />}
                    </AccordionContent>
                </AccordionItem>
            ))}
        </Accordion>
    </div>

    {/* Create Folder Dialog */}
     <Dialog open={isFolderCreating} onOpenChange={setIsFolderCreating}>
        <DialogContent><DialogHeader><DialogTitle>Create New Folder</DialogTitle><DialogDescription>Enter a name for the new folder. You can upload files to it after creation.</DialogDescription></DialogHeader>
        <div className="py-4"><Input placeholder="Folder name..." value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} onKeyPress={(e) => e.key === 'Enter' && handleCreateFolder()} /></div>
        <DialogFooter><Button onClick={handleCreateFolder}>Create</Button></DialogFooter></DialogContent>
     </Dialog>
     
     {/* Rename Folder Dialog */}
      <Dialog open={!!renamingFolder} onOpenChange={() => setRenamingFolder(null)}>
        <DialogContent><DialogHeader><DialogTitle>Rename Folder</DialogTitle><DialogDescription>Enter a new name for the folder "{renamingFolder}".</DialogDescription></DialogHeader>
        <div className="py-4"><Input placeholder="New folder name..." defaultValue={renamingFolder || ''} onChange={(e) => setNewRenamedFolder(e.target.value)} onKeyPress={(e) => e.key === 'Enter' && handleRenameFolder()} /></div>
        <DialogFooter><Button onClick={handleRenameFolder}>Rename</Button></DialogFooter></DialogContent>
     </Dialog>
    </>
  );
}
