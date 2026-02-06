'use client';

import { useState } from 'react';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

import { storage, db } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/shared/spinner';
import { useToast } from '@/hooks/use-toast';
import type { UserProfile } from '@/types';

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
    } catch (err) {
      console.error(err);
      toast({
        variant: 'destructive',
        title: 'Upload failed',
        description: 'Could not upload file.',
      });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <h3 className="font-semibold">Upload Document</h3>

      <Input
        type="file"
        onChange={(e) => setFile(e.target.files?.[0] || null)}
      />

      <Button onClick={handleUpload} disabled={!file || uploading}>
        {uploading ? <Spinner /> : 'Upload'}
      </Button>
    </div>
  );
}
