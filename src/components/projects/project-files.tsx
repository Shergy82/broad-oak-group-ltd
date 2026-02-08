'use client';

import { useEffect, useMemo, useState } from 'react';
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
  type UploadMetadata,
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

import { FileText, Download, Trash2, Upload, Eye } from 'lucide-react';

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

  // Preview modal state (keeps user in-app; better on some mobiles)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState<string | null>(null);
  const [previewType, setPreviewType] = useState<string | null>(null);

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

  /* ---------------- Helpers ---------------- */

  const canDelete = (f: ProjectFile) =>
    f.uploaderId === userProfile.uid ||
    ['admin', 'owner', 'manager'].includes(userProfile.role);

  const isImageName = (name: string) => /\.(png|jpe?g|gif|webp)$/i.test(name);
  const isPdfName = (name: string) => /\.pdf$/i.test(name);

  function getFileViewUrl(file: ProjectFile): string {
    const office = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'];
    const ext = (file.name ?? '').split('.').pop()?.toLowerCase();

    if (ext && office.includes(ext)) {
      return `https://docs.google.com/gview?url=${encodeURIComponent(
        file.url
      )}&embedded=true`;
    }

    return file.url;
  }

  /* ---------------- Open / Download ---------------- */

  async function getFreshUrl(fullPath: string) {
    return getDownloadURL(ref(storage, fullPath));
  }

  async function openFile(file: ProjectFile) {
    try {
      const url = await getFreshUrl(file.fullPath);
      setPreviewUrl(url);
      setPreviewName(file.name ?? 'Preview');
      setPreviewType(file.type ?? '');
    } catch (e) {
      console.error(e);
      toast({
        variant: 'destructive',
        title: 'Open failed',
        description: 'Could not load file preview',
      });
    }
  }

  async function downloadFile(file: ProjectFile) {
    try {
      const url = await getFreshUrl(file.fullPath);

      const a = document.createElement('a');
      a.href = url;
      a.download = file.name || 'download';
      a.rel = 'noreferrer';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      console.error(e);
      toast({
        variant: 'destructive',
        title: 'Download failed',
        description: 'Could not download file',
      });
    }
  }

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

        // IMPORTANT for mobile: force inline viewing + set correct content-type.
        const metadata: UploadMetadata = {
          contentType: file.type || 'application/octet-stream',
          contentDisposition: 'inline',
          cacheControl: 'public,max-age=3600',
        };

        const refFile = ref(storage, path);
        const task = uploadBytesResumable(refFile, file, metadata);

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

  /* ---------------- Preview Kind ---------------- */

  const previewKind = useMemo(() => {
    const name = previewName ?? '';
    const type = previewType ?? '';
    if (type.startsWith('image/') || isImageName(name)) return 'image';
    if (type === 'application/pdf' || isPdfName(name)) return 'pdf';
    return 'other';
  }, [previewName, previewType]);

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
                  <TableCell className="truncate max-w-[220px]">
                    {/* Primary behaviour: open in browser with a real link (mobile-friendly) */}
                    <a
                      href={getFileViewUrl(f)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline block truncate max-w-[220px]"
                      title={f.name}
                    >
                      {f.name}
                    </a>

                    <div className="text-xs text-muted-foreground">
                      {typeof f.size === 'number'
                        ? `${(f.size / 1024 / 1024).toFixed(2)} MB`
                        : '—'}
                    </div>
                  </TableCell>

                  <TableCell className="text-xs">{f.uploaderName}</TableCell>

                  <TableCell className="text-right space-x-1">
                    {/* Optional: in-app preview (uses fresh URL). Keep if you want the eye icon preview. */}
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => openFile(f)}
                      title="Preview"
                      type="button"
                    >
                      <Eye className="h-4 w-4" />
                    </Button>

                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => downloadFile(f)}
                      title="Download"
                      type="button"
                    >
                      <Download className="h-4 w-4" />
                    </Button>

                    {canDelete(f) && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="text-destructive"
                            title="Delete"
                            type="button"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>

                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete file?</AlertDialogTitle>
                            <AlertDialogDescription>
                              {f.name}
                            </AlertDialogDescription>
                          </AlertDialogHeader>

                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
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

      {/* In-app preview modal */}
      {previewUrl && (
        <AlertDialog open onOpenChange={(o) => !o && setPreviewUrl(null)}>
          <AlertDialogContent className="max-w-3xl">
            <AlertDialogHeader>
              <AlertDialogTitle>{previewName ?? 'Preview'}</AlertDialogTitle>
              <AlertDialogDescription />
            </AlertDialogHeader>

            <div className="w-full">
              {previewKind === 'image' ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewUrl}
                  alt={previewName ?? 'preview'}
                  className="w-full h-auto rounded"
                />
              ) : previewKind === 'pdf' ? (
                <iframe src={previewUrl} className="w-full h-[70vh] rounded" />
              ) : (
                <div className="text-sm text-muted-foreground">
                  Preview not available for this file type.
                </div>
              )}
            </div>

            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setPreviewUrl(null)}>
                Close
              </AlertDialogCancel>

              <AlertDialogAction
                onClick={() =>
                  window.open(previewUrl, '_blank', 'noopener,noreferrer')
                }
              >
                Open in browser
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
