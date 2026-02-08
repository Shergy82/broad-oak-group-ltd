'use client';

import { useEffect, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { auth, db, storage, functions, httpsCallable } from '@/lib/firebase';

import {
  collection,
  onSnapshot,
  query,
  orderBy,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';

import {
  ref,
  uploadBytesResumable,
  getDownloadURL,
} from 'firebase/storage';

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
} from '@/components/ui/alert-dialog';

import { FileText, Download, Trash2, Upload } from 'lucide-react';

import type { Project, ProjectFile, UserProfile } from '@/types';

interface Props {
  project: Project;
  userProfile: UserProfile;
}

export function ProjectFiles({ project, userProfile }: Props) {
  const { toast } = useToast();

  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  /* ---------------- Load Files ---------------- */

  useEffect(() => {
    if (!project?.id) return;

    const q = query(
      collection(db, `projects/${project.id}/files`),
      orderBy('uploadedAt', 'desc')
    );

    return onSnapshot(
      q,
      (snap) => {
        setFiles(
          snap.docs.map((d) => ({ id: d.id, ...d.data() } as ProjectFile))
        );
        setLoading(false);
      },
      (err) => {
        console.error(err);
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'Failed to load files',
        });
        setLoading(false);
      }
    );
  }, [project?.id, toast]);

  /* ---------------- Upload ---------------- */

  async function handleUpload(list: FileList | null) {
    const uid = auth.currentUser?.uid;
  
    if (!uid) {
      toast({
        variant: 'destructive',
        title: 'Not logged in',
        description: 'Please sign in again',
      });
      return;
    }
  
    if (!list?.length) return;
  
    setUploading(true);
  
    try {
      for (const file of Array.from(list)) {
        const path = `project_files/${project.id}/${Date.now()}-${file.name}`;
  
        const refFile = ref(storage, path);
        const task = uploadBytesResumable(refFile, file);
  
        await new Promise<void>((resolve, reject) => {
          task.on('state_changed', null, reject, resolve);
        });
  
        const url = await getDownloadURL(task.snapshot.ref);
  
        await addDoc(collection(db, `projects/${project.id}/files`), {
          name: file.name,
          url,
          fullPath: path,
          size: file.size,
          type: file.type || '',
          uploadedAt: serverTimestamp(),
          uploaderId: uid,
          uploaderName: userProfile?.name || 'System',
        });
      }
  
      toast({ title: 'Success', description: 'Files uploaded' });
    } catch (err) {
      console.error(err);
      toast({
        variant: 'destructive',
        title: 'Upload failed',
        description: 'Check permissions',
      });
    } finally {
      setUploading(false);
    }
  }  

  /* ---------------- Delete ---------------- */

  async function handleDelete(file: ProjectFile) {
    try {
      const fn = httpsCallable(functions, 'deleteProjectFile');

      await fn({
        projectId: project.id,
        fileId: file.id,
      });

      toast({ title: 'Deleted' });

    } catch (e: any) {
      console.error(e);

      toast({
        variant: 'destructive',
        title: 'Delete failed',
        description: e?.message,
      });
    }
  }

  const canDelete = (f: ProjectFile) =>
    f.uploaderId === userProfile.uid ||
    ['admin', 'owner', 'manager'].includes(userProfile.role);

  /* ---------------- UI ---------------- */

  return (
    <div className="space-y-4">

      <h4 className="font-semibold text-sm">Attached Files</h4>

      {loading ? (
        <>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </>
      ) : files.length === 0 ? (
        <div className="text-center p-4 border rounded-lg text-muted-foreground">
          <FileText className="mx-auto h-8 w-8 opacity-50" />
          <p className="mt-2 text-sm">No files yet</p>
        </div>
      ) : (
        <div className="border rounded-lg max-h-60 overflow-y-auto">

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File</TableHead>
                <TableHead>By</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {files.map((f) => (
                <TableRow key={f.id}>

                  <TableCell className="truncate max-w-[180px]">
                    <a
                      href={f.url}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:underline"
                    >
                      {f.name}
                    </a>

                    <div className="text-xs text-muted-foreground">
                    {typeof f.size === 'number' ? `${(f.size / 1024 / 1024).toFixed(2)} MB` : '—'}
                    </div>
                  </TableCell>

                  <TableCell className="text-xs">
                    {f.uploaderName}
                  </TableCell>

                  <TableCell className="text-right space-x-1">

                    <a href={f.url} download>
                      <Button size="icon" variant="ghost">
                        <Download className="h-4 w-4" />
                      </Button>
                    </a>

                    {canDelete(f) && (
                      <AlertDialog>

                        <AlertDialogTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>

                        <AlertDialogContent>

                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              Delete file?
                            </AlertDialogTitle>

                            <AlertDialogDescription>
                              {f.name}
                            </AlertDialogDescription>
                          </AlertDialogHeader>

                          <AlertDialogFooter>

                            <AlertDialogCancel>
                              Cancel
                            </AlertDialogCancel>

                            <AlertDialogAction
                              onClick={() => handleDelete(f)}
                              className="bg-destructive"
                            >
                              Delete
                            </AlertDialogAction>

                          </AlertDialogFooter>

                        </AlertDialogContent>
                      </AlertDialog>
                    )}

                  </TableCell>

                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Input
        id={`upload-${project.id}`}
        type="file"
        multiple
        hidden
        disabled={uploading}
        onChange={(e) => handleUpload(e.target.files)}
      />

      <Button asChild disabled={uploading} className="w-full">
        <Label htmlFor={`upload-${project.id}`}>

          {uploading ? (
            <>
              <Spinner /> Uploading...
            </>
          ) : (
            <>
              <Upload className="mr-2 h-4 w-4" />
              Upload Files
            </>
          )}

        </Label>
      </Button>

    </div>
  );
}
