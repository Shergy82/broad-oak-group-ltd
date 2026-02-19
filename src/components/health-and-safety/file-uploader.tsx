'use client';

import { useState, useCallback } from 'react';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

import { storage, db } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/shared/spinner';
import { useToast } from '@/hooks/use-toast';
import type { UserProfile } from '@/types';
import { UploadCloud } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';

interface Props {
  userProfile: UserProfile;
  folder?: string;
}

export function FileUploader({ userProfile, folder }: Props) {
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const { toast } = useToast();

  const handleFileUpload = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    setIsUploading(true);

    const uploadPromises = Array.from(files).map(file => {
      const relativePath = (file as any).webkitRelativePath || file.name;
      const storagePath = `health_and_safety/${folder ? `${folder}/` : ''}${relativePath}`;

      const pathParts = relativePath.split('/');
      let firestoreFolder = folder || '';
      if (pathParts.length > 1) {
        const subPath = pathParts.slice(0, -1).join('/');
        firestoreFolder = folder ? `${folder}/${subPath}` : subPath;
      }
      
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
              const docData: any = {
                name: file.name,
                url: downloadURL,
                fullPath: storagePath,
                size: file.size,
                type: file.type,
                uploadedAt: serverTimestamp(),
                uploaderId: userProfile?.uid || "system",
                uploaderName: userProfile.name,
              };
              if (firestoreFolder) {
                docData.folder = firestoreFolder;
              }
              await addDoc(collection(db, 'health_and_safety_files'), docData);
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
      })
      .catch((error) => {
        console.error('Error during file upload process:', error);
        toast({ variant: 'destructive', title: 'Upload Failed', description: 'One or more files failed to upload. Please check your project permissions and try again.' });
      })
      .finally(() => {
        setIsUploading(false);
        const fileInput = document.getElementById(`hs-file-input-${folder || 'root'}`) as HTMLInputElement;
        if (fileInput) {
            fileInput.value = "";
        }
      });
  }, [userProfile, folder, toast]);
  
  const onDrop = useCallback(async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const getFile = (entry: FileSystemFileEntry): Promise<File> => {
        return new Promise((resolve, reject) => entry.file(resolve, reject));
    };

    const getEntries = (reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> => {
        return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    };

    const traverse = async (entry: FileSystemEntry | null): Promise<File[]> => {
        if (!entry) return [];
        if (entry.isFile) {
            const file = await getFile(entry as FileSystemFileEntry);
            Object.defineProperty(file, 'webkitRelativePath', {
                value: entry.fullPath.startsWith('/') ? entry.fullPath.substring(1) : entry.fullPath,
                writable: true,
                configurable: true,
            });
            return [file];
        }
        if (entry.isDirectory) {
            const reader = (entry as FileSystemDirectoryEntry).createReader();
            let allEntries: FileSystemEntry[] = [];
            let currentEntries;
            do {
                currentEntries = await getEntries(reader);
                allEntries = allEntries.concat(currentEntries);
            } while (currentEntries.length > 0);

            const fileArrays = await Promise.all(allEntries.map(e => traverse(e)));
            return fileArrays.flat();
        }
        return [];
    };

    let allFiles: File[] = [];

    if (e.dataTransfer.items) {
        const entryPromises = Array.from(e.dataTransfer.items)
            .map(item => item.webkitGetAsEntry())
            .map(entry => traverse(entry));
        allFiles = (await Promise.all(entryPromises)).flat();
    } else {
        allFiles = Array.from(e.dataTransfer.files);
    }
    
    if (allFiles.length > 0) {
      const dataTransfer = new DataTransfer();
      allFiles.forEach(file => dataTransfer.items.add(file));
      handleFileUpload(dataTransfer.files);
    }
  }, [handleFileUpload]);
  
  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const onDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };
  
  return (
        <div
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          className={cn(
            "flex flex-col items-center justify-center p-6 border-2 border-dashed border-muted-foreground/30 rounded-lg text-center transition-colors",
            isDragOver && "border-primary bg-primary/10"
          )}
        >
            <UploadCloud className="h-12 w-12 text-muted-foreground" />
            <h3 className="mt-2 text-sm font-medium text-foreground">
                Drag & drop files or folders here
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">or click to browse</p>
            <Input
              id={`hs-file-input-${folder || 'root'}`}
              type="file"
              multiple
              // @ts-ignore
              webkitdirectory="true"
              onChange={(e) => handleFileUpload(e.target.files)}
              className="sr-only"
              disabled={isUploading}
            />
            <Button asChild variant="link" className="mt-2">
              <Label htmlFor={`hs-file-input-${folder || 'root'}`} className="cursor-pointer">Browse files or folders</Label>
            </Button>
            {isUploading && <div className="mt-4 flex items-center gap-2"><Spinner /> Uploading...</div>}
        </div>
  );
}
