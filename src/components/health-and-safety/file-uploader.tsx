'use client';

import { useState } from 'react';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';

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
}

export function HealthAndSafetyUploader({ userProfile }: Props) {
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const { toast } = useToast();

  const handleFileUpload = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setIsUploading(true);

    const uploadPromises = Array.from(files).map(file => {
      const storagePath = `health_and_safety/${Date.now()}-${file.name}`;
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
              await addDoc(collection(db, 'health_and_safety_files'), {
                name: file.name,
                url: downloadURL,
                fullPath: storagePath,
                size: file.size,
                type: file.type,
                uploadedAt: serverTimestamp(),
                uploaderId: userProfile?.uid || "system",
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
      })
      .catch((error) => {
        console.error('Error during file upload process:', error);
        toast({ variant: 'destructive', title: 'Upload Failed', description: 'One or more files failed to upload. Please check your project permissions and try again.' });
      })
      .finally(() => {
        setIsUploading(false);
        const fileInput = document.getElementById('hs-file-input') as HTMLInputElement;
        if (fileInput) {
            fileInput.value = "";
        }
      });
  };

  const onDragProps = {
    onDragOver: (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragOver(true);
    },
    onDragLeave: (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragOver(false);
    },
    onDrop: (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragOver(false);
      handleFileUpload(e.dataTransfer.files);
    }
  };
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload H&S Document</CardTitle>
        <CardDescription>Upload a new health and safety document for the team to access.</CardDescription>
      </CardHeader>
      <CardContent>
        <div
          {...onDragProps}
          className={cn(
            "flex flex-col items-center justify-center p-6 border-2 border-dashed border-muted-foreground/30 rounded-lg text-center transition-colors",
            isDragOver && "border-primary bg-primary/10"
          )}
        >
            <UploadCloud className="h-12 w-12 text-muted-foreground" />
            <h3 className="mt-2 text-sm font-medium text-foreground">
                Drag & drop files here
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">or click to select files</p>
            <Input
              id="hs-file-input"
              type="file"
              multiple
              onChange={(e) => handleFileUpload(e.target.files)}
              className="sr-only"
              disabled={isUploading}
            />
            <Button asChild variant="link" className="mt-2">
              <Label htmlFor="hs-file-input" className="cursor-pointer">Browse files</Label>
            </Button>
            {isUploading && <div className="mt-4 flex items-center gap-2"><Spinner /> Uploading...</div>}
        </div>
      </CardContent>
    </Card>
  );
}
