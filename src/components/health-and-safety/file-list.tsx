'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { collection, onSnapshot, query, orderBy, doc, deleteDoc, addDoc, serverTimestamp, writeBatch, getDocs, where, deleteField } from 'firebase/firestore';
import { ref, deleteObject, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { db, storage } from '@/lib/firebase';
import type { HealthAndSafetyFile, UserProfile } from '@/types';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Download, Trash2, FileText, PlusCircle, Folder, FolderPlus, FolderCog, FolderX } from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/shared/spinner';
import { FileUploader } from './file-uploader';

interface HealthAndSafetyFileListProps {
  userProfile: UserProfile;
}

export function HealthAndSafetyFileList({ userProfile }: HealthAndSafetyFileListProps) {
  const [files, setFiles] = useState<HealthAndSafetyFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFolderCreating, setIsFolderCreating] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [newRenamedFolder, setNewRenamedFolder] = useState('');
  
  const [deletingFolder, setDeletingFolder] = useState<string | null>(null);

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
  }, [files]);
  
  const allFolderNames = useMemo(() => files.reduce((acc, file) => {
    if (file.folder) acc.add(file.folder);
    return acc;
  }, new Set<string>()), [files]);

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

  const handleCreateFolder = () => {
    if (!newFolderName.trim()) {
      toast({ variant: 'destructive', title: 'Folder name cannot be empty.' });
      return;
    }
    if (allFolderNames.has(newFolderName.trim())) {
      toast({ variant: 'destructive', title: 'Folder already exists.' });
      return;
    }
    // This is a UI-only creation. The folder "exists" once a file is added to it.
    // To make it appear, we can add it to a temporary local state. But it's better to just upload a file to it.
    toast({ title: 'Folder Created', description: `Upload a file into the "${newFolderName.trim()}" folder to make it appear.`});
    setIsFolderCreating(false);
    setNewFolderName('');
  };

  const handleRenameFolder = async () => {
    if (!renamingFolder || !newRenamedFolder.trim()) return;

    toast({ title: "Renaming folder...", description: "Please wait." });
    try {
        const q = query(collection(db, 'health_and_safety_files'), where('folder', '==', renamingFolder));
        const snapshot = await getDocs(q);
        
        if (snapshot.empty) {
            toast({ variant: 'destructive', title: 'Folder is empty or does not exist.' });
            return;
        }
        
        const batch = writeBatch(db);
        snapshot.docs.forEach(document => {
            batch.update(doc(db, 'health_and_safety_files', document.id), { folder: newRenamedFolder.trim() });
        });

        await batch.commit();
        toast({ title: 'Success!', description: `Folder "${renamingFolder}" was renamed to "${newRenamedFolder.trim()}".` });
    } catch (error) {
        console.error("Error renaming folder:", error);
        toast({ variant: 'destructive', title: 'Error', description: "Could not rename folder." });
    } finally {
        setRenamingFolder(null);
        setNewRenamedFolder('');
    }
  };
  
  const handleDeleteFolder = async () => {
      if (!deletingFolder) return;
      toast({ title: "Deleting folder...", description: "Files inside will be moved to Uncategorized." });
      try {
        const q = query(collection(db, 'health_and_safety_files'), where('folder', '==', deletingFolder));
        const snapshot = await getDocs(q);
        
        const batch = writeBatch(db);
        snapshot.docs.forEach(document => {
            const docRef = doc(db, 'health_and_safety_files', document.id);
            batch.update(docRef, { folder: deleteField() });
        });

        await batch.commit();
        toast({ title: 'Success!', description: `Folder "${deletingFolder}" was deleted.` });
    } catch (error) {
        console.error("Error deleting folder:", error);
        toast({ variant: 'destructive', title: 'Error', description: "Could not delete folder." });
    } finally {
        setDeletingFolder(null);
    }
  }


  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const renderFileList = (filesToList: HealthAndSafetyFile[]) => (
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
              <TableCell className="font-medium">{file.name}</TableCell>
              <TableCell>{file.uploaderName}</TableCell>
              <TableCell>{file.uploadedAt ? format(file.uploadedAt.toDate(), 'dd MMM yyyy') : 'Just now'}</TableCell>
              <TableCell>{formatFileSize(file.size)}</TableCell>
              <TableCell className="text-right">
                <Button variant="ghost" size="icon" asChild>
                  <a href={file.url} target="_blank" rel="noopener noreferrer" download={file.name}>
                    <Download className="h-4 w-4" />
                  </a>
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
    <div className="space-y-4">
        {isPrivilegedUser && (
            <div className="flex justify-end">
                <Button onClick={() => setIsFolderCreating(true)}>
                    <FolderPlus className="mr-2 h-4 w-4" /> Create Folder
                </Button>
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
                                        <AlertDialogHeader><AlertDialogTitle>Delete Folder?</AlertDialogTitle><AlertDialogDescription>Are you sure you want to delete the "{folderName}" folder? All files inside will be moved to "Uncategorized".</AlertDialogDescription></AlertDialogHeader>
                                        <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => handleDeleteFolder()} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">Delete Folder</AlertDialogAction></AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            </div>
                        )}
                        {renderFileList(folderFiles)}
                        {isPrivilegedUser && <FileUploader userProfile={userProfile} folder={folderName} />}
                    </AccordionContent>
                </AccordionItem>
            ))}
             <AccordionItem value="uncategorized">
                <AccordionTrigger>
                    <div className="flex items-center gap-2 text-lg font-semibold">
                        <FileText /> Uncategorized Files <span className="text-sm font-normal text-muted-foreground">({uncategorizedFiles.length})</span>
                    </div>
                </AccordionTrigger>
                <AccordionContent className="p-4 bg-muted/50 rounded-b-md space-y-4">
                    {uncategorizedFiles.length > 0 ? renderFileList(uncategorizedFiles) : <p className="text-sm text-center text-muted-foreground">No uncategorized files.</p>}
                    {isPrivilegedUser && <FileUploader userProfile={userProfile} />}
                </AccordionContent>
             </AccordionItem>
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
