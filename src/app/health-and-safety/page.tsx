
'use client';

import { useState, useEffect } from 'react';
import { useUserProfile } from '@/hooks/use-user-profile';
import { db, storage } from '@/lib/firebase';
import {
  collection,
  addDoc,
  serverTimestamp,
  onSnapshot,
  query,
  orderBy
} from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/shared/spinner';
import { useToast } from '@/hooks/use-toast';
import { Upload, HardHat } from 'lucide-react';
import type { UserProfile, HealthAndSafetyFile } from '@/types';
import { Header } from '@/components/layout/header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/use-auth';
import { useRouter } from 'next/navigation';

function FileUploader({ userProfile, onUploadComplete }: { userProfile: UserProfile, onUploadComplete: () => void }) {
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();

  const handleFileUpload = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (!userProfile) {
        toast({ variant: 'destructive', title: 'Error', description: 'You must be logged in to upload files.' });
        return;
    }
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
      .catch((err) => {
        let description = 'One or more files failed to upload. Please try again.';
        if (err?.code?.includes('permission-denied')) {
            description = "Permission denied. Check storage & database rules.";
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
  
  const isPrivilegedUser = userProfile && ['admin', 'owner'].includes(userProfile.role);

  useEffect(() => {
    if (!isAuthLoading && !user) {
      router.push('/login');
    }
  }, [user, isAuthLoading, router]);

  if (isAuthLoading || isProfileLoading) {
    return (
      <div className="flex min-h-screen w-full flex-col items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!user) {
    // This state should be brief as the effect above will redirect.
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
                <CardTitle>Health &amp; Safety Documents</CardTitle>
                <CardDescription>General Health &amp; Safety documents and resources. Admins can upload new files.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                {isPrivilegedUser && userProfile ? (
                    <div className="max-w-md mx-auto">
                        <h3 className="text-lg font-semibold text-center mb-4">Upload Documents</h3>
                        <FileUploader userProfile={userProfile} onUploadComplete={() => {
                            const fileInput = document.getElementById('hs-file-upload') as HTMLInputElement;
                            if (fileInput) fileInput.value = "";
                        }} />
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
                        <HardHat className="mx-auto h-12 w-12 text-muted-foreground" />
                        <h3 className="mt-4 text-lg font-semibold">Documents Area</h3>
                        <p className="mb-4 mt-2 text-sm text-muted-foreground">
                            This area is for viewing Health &amp; Safety documents.
                            <br/>
                            Uploading is restricted to admins and owners.
                        </p>
                    </div>
                )}
            </CardContent>
        </Card>
      </main>
    </div>
  );
}
