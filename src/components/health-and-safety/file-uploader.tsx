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

interface Props {
  userProfile: UserProfile;
}

export function HealthAndSafetyUploader({ userProfile }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();

  async function handleUpload() {
    if (!file) return;

    setUploading(true);

    try {
      const path = `health_and_safety/${Date.now()}-${file.name}`;
      const storageRef = ref(storage, path);

      const task = uploadBytesResumable(storageRef, file);

      await new Promise<void>((resolve, reject) => {
        task.on('state_changed', undefined, reject, () => resolve());
      });

      const url = await getDownloadURL(storageRef);

      await addDoc(collection(db, 'health_and_safety_files'), {
        name: file.name,
        url,
        fullPath: path,
        size: file.size,
        type: file.type,
        uploadedAt: serverTimestamp(),
        uploaderId: userProfile?.uid || "system",
        uploaderName: userProfile.name,
      });

      toast({
        title: 'Upload complete',
        description: 'File uploaded successfully.',
      });

      setFile(null);
      // Clear the file input
      const fileInput = document.getElementById('hs-file-input') as HTMLInputElement;
      if (fileInput) fileInput.value = '';

    } catch (err) {
      console.error(err);
      toast({
        variant: 'destructive',
        title: 'Upload failed',
        description: 'Could not upload file. Check permissions.',
      });
    } finally {
      setUploading(false);
    }
  }

  return (
    <Card>
        <CardHeader>
            <CardTitle>Upload H&S Document</CardTitle>
            <CardDescription>Upload a new health and safety document for the team to access.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row gap-4 items-center">
          <Input
            id="hs-file-input"
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="flex-grow"
          />
          <Button onClick={handleUpload} disabled={!file || uploading} className="w-full sm:w-auto">
            {uploading ? <Spinner /> : <><UploadCloud className="mr-2 h-4 w-4" /> Upload Document</>}
          </Button>
        </CardContent>
    </Card>
  );
}
