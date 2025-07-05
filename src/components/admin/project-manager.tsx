
'use client';

import { useState, useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { db, storage } from '@/lib/firebase';
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  addDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { useToast } from '@/hooks/use-toast';
import { PlusCircle, UploadCloud, File as FileIcon, Trash2, FolderOpen } from 'lucide-react';
import type { Project, ProjectFile, UserProfile } from '@/types';
import { cn } from '@/lib/utils';
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
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';


const projectSchema = z.object({
  address: z.string().min(1, 'Address is required.'),
  bNumber: z.string().min(1, 'B Number is required.'),
  council: z.string().min(1, 'Council is required.'),
  manager: z.string().min(1, 'Manager is required.'),
});

interface CreateProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userProfile: UserProfile;
}

function CreateProjectDialog({ open, onOpenChange, userProfile }: CreateProjectDialogProps) {
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  
  const form = useForm<z.infer<typeof projectSchema>>({
    resolver: zodResolver(projectSchema),
    defaultValues: { address: '', bNumber: '', council: '', manager: '' },
  });

  const handleCreateProject = async (values: z.infer<typeof projectSchema>) => {
    setIsLoading(true);
    try {
      const reviewDate = new Date();
      reviewDate.setDate(reviewDate.getDate() + 28); // 4 weeks

      await addDoc(collection(db, 'projects'), {
        ...values,
        createdBy: userProfile.name,
        creatorId: userProfile.uid,
        createdAt: serverTimestamp(),
        nextReviewDate: Timestamp.fromDate(reviewDate),
      });
      toast({ title: 'Success', description: 'Project created successfully.' });
      form.reset();
      onOpenChange(false);
    } catch (error) {
      console.error('Error creating project:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'Could not create project. Check Firestore rules.' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <PlusCircle className="mr-2" />
          Create New Project
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New Project</DialogTitle>
          <DialogDescription>Add a new project to the database. You can upload files to it after creation.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleCreateProject)} className="space-y-4 py-4">
            <FormField control={form.control} name="address" render={({ field }) => (
                <FormItem><FormLabel>Address</FormLabel><FormControl><Input placeholder="123 Main Street..." {...field} /></FormControl><FormMessage /></FormItem>
            )}/>
            <FormField control={form.control} name="bNumber" render={({ field }) => (
                <FormItem><FormLabel>B Number</FormLabel><FormControl><Input placeholder="B-..." {...field} /></FormControl><FormMessage /></FormItem>
            )}/>
            <FormField control={form.control} name="council" render={({ field }) => (
                <FormItem><FormLabel>Council</FormLabel><FormControl><Input placeholder="Council Name" {...field} /></FormControl><FormMessage /></FormItem>
            )}/>
            <FormField control={form.control} name="manager" render={({ field }) => (
                <FormItem><FormLabel>Manager</FormLabel><FormControl><Input placeholder="Manager Name" {...field} /></FormControl><FormMessage /></FormItem>
            )}/>
             <DialogFooter>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>Cancel</Button>
                <Button type="submit" disabled={isLoading}>
                    {isLoading ? <Spinner /> : 'Create Project'}
                </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function FileUploader({ project, userProfile }: { project: Project; userProfile: UserProfile }) {
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const { toast } = useToast();

  const handleFileUpload = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setIsUploading(true);

    const uploadPromises = Array.from(files).map(file => {
      const storagePath = `project_files/${project.id}/${Date.now()}-${file.name}`;
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
              await addDoc(collection(db, `projects/${project.id}/files`), {
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
      .then(() => toast({ title: 'Success', description: `${files.length} file(s) uploaded successfully.` }))
      .catch(() => toast({ variant: 'destructive', title: 'Upload Failed', description: 'One or more files failed to upload. Please try again.' }))
      .finally(() => setIsUploading(false));
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
            id={`file-upload-${project.id}`}
            type="file" 
            multiple 
            className="sr-only" 
            onChange={(e) => handleFileUpload(e.target.files)}
            disabled={isUploading}
        />
        <Button asChild variant="link" className="mt-2">
            <Label htmlFor={`file-upload-${project.id}`} className="cursor-pointer">Browse files</Label>
        </Button>
        {isUploading && <div className="mt-4 flex items-center gap-2"><Spinner /> Uploading...</div>}
    </div>
  );
}

function FileManagerDialog({ project, open, onOpenChange, userProfile }: { project: Project | null, open: boolean, onOpenChange: (open: boolean) => void, userProfile: UserProfile }) {
    const [files, setFiles] = useState<ProjectFile[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const { toast } = useToast();

    useEffect(() => {
        if (!project) return;
        setIsLoading(true);
        const q = query(collection(db, `projects/${project.id}/files`), orderBy('uploadedAt', 'desc'));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            setFiles(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ProjectFile)));
            setIsLoading(false);
        }, (error) => {
            console.error("Error fetching files:", error);
            setIsLoading(false);
        });
        return () => unsubscribe();
    }, [project]);

    const handleDeleteFile = async (file: ProjectFile) => {
        if (!project) return;
        try {
            const fileRef = ref(storage, file.fullPath);
            await deleteObject(fileRef);
            await deleteDoc(doc(db, `projects/${project.id}/files`, file.id));
            toast({ title: "File Deleted", description: `Successfully deleted ${file.name}.` });
        } catch (error) {
            console.error("Error deleting file:", error);
            toast({ variant: 'destructive', title: "Error", description: "Could not delete file. Check Firestore rules and Storage permissions." });
        }
    };

    const formatFileSize = (bytes?: number) => {
        if (!bytes) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    if (!project) return null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl">
                <DialogHeader>
                    <DialogTitle>Manage Files for: {project.address}</DialogTitle>
                    <DialogDescription>Upload new files or delete existing ones for this project.</DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 py-4">
                    <div className="space-y-4">
                        <h4 className="font-semibold">Upload New Files</h4>
                        <FileUploader project={project} userProfile={userProfile} />
                    </div>
                    <div className="space-y-4">
                        <h4 className="font-semibold">Existing Files</h4>
                        {isLoading ? <Skeleton className="h-48 w-full" /> : files.length === 0 ? (
                            <div className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-muted-foreground/30 rounded-lg text-center h-full">
                                <FileIcon className="h-12 w-12 text-muted-foreground" />
                                <p className="mt-2 text-sm text-muted-foreground">No files uploaded yet.</p>
                            </div>
                        ) : (
                            <div className="border rounded-lg max-h-64 overflow-y-auto">
                                <Table>
                                    <TableBody>
                                        {files.map(file => (
                                            <TableRow key={file.id}>
                                                <TableCell className="font-medium truncate max-w-[200px]">{file.name}</TableCell>
                                                <TableCell className="text-right text-xs text-muted-foreground">{formatFileSize(file.size)}</TableCell>
                                                <TableCell className="text-right">
                                                    <AlertDialog>
                                                        <AlertDialogTrigger asChild>
                                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive/70 hover:text-destructive hover:bg-destructive/10">
                                                                <Trash2 className="h-4 w-4" />
                                                            </Button>
                                                        </AlertDialogTrigger>
                                                        <AlertDialogContent>
                                                            <AlertDialogHeader>
                                                                <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                                                <AlertDialogDescription>This will permanently delete the file <span className="font-semibold">{file.name}</span>. This action cannot be undone.</AlertDialogDescription>
                                                            </AlertDialogHeader>
                                                            <AlertDialogFooter>
                                                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                                <AlertDialogAction onClick={() => handleDeleteFile(file)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
                                                            </AlertDialogFooter>
                                                        </AlertDialogContent>
                                                    </AlertDialog>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

interface ProjectManagerProps {
  userProfile: UserProfile;
}

export function ProjectManager({ userProfile }: ProjectManagerProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isCreateProjectDialogOpen, setCreateProjectDialogOpen] = useState(false);
  const [isFileManagerOpen, setFileManagerOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'projects'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setProjects(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)));
      setLoading(false);
    }, (error) => {
      console.error("Error fetching projects:", error);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const filteredProjects = useMemo(() => {
    return projects.filter(project =>
      project.address.toLowerCase().includes(searchTerm.toLowerCase()) ||
      project.bNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      project.council?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      project.manager?.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [projects, searchTerm]);

  const handleManageFiles = (project: Project) => {
    setSelectedProject(project);
    setFileManagerOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-4 justify-between">
        <Input
          placeholder="Search projects..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="max-w-sm"
        />
        <CreateProjectDialog 
          open={isCreateProjectDialogOpen} 
          onOpenChange={setCreateProjectDialogOpen} 
          userProfile={userProfile} 
        />
      </div>

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : filteredProjects.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
            <FolderOpen className="mx-auto h-12 w-12 text-muted-foreground" />
            <h3 className="mt-4 text-lg font-semibold">No Projects Found</h3>
            <p className="mb-4 mt-2 text-sm text-muted-foreground">
                Create a new project to get started.
            </p>
        </div>
      ) : (
        <>
            {/* Desktop Table View */}
            <div className="border rounded-lg hidden md:block">
                <Table>
                <TableHeader>
                    <TableRow>
                    <TableHead>Address</TableHead>
                    <TableHead>B Number</TableHead>
                    <TableHead>Manager</TableHead>
                    <TableHead>Created At</TableHead>
                    <TableHead>Created By</TableHead>
                    <TableHead>Next Review</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {filteredProjects.map(project => (
                        <TableRow key={project.id}>
                        <TableCell className="font-medium">{project.address}</TableCell>
                        <TableCell>{project.bNumber}</TableCell>
                        <TableCell>{project.manager}</TableCell>
                        <TableCell>{project.createdAt ? format(project.createdAt.toDate(), 'dd/MM/yyyy') : 'N/A'}</TableCell>
                        <TableCell>{project.createdBy ?? 'N/A'}</TableCell>
                        <TableCell>{project.nextReviewDate ? format(project.nextReviewDate.toDate(), 'dd/MM/yyyy') : 'N/A'}</TableCell>
                        <TableCell className="text-right">
                            <Button variant="outline" size="sm" onClick={() => handleManageFiles(project)}>
                            <FolderOpen className="mr-2 h-4 w-4" />
                            Manage Files
                            </Button>
                        </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
                </Table>
            </div>

            {/* Mobile Card View */}
            <div className="grid gap-4 md:hidden">
                {filteredProjects.map(project => (
                    <Card key={project.id}>
                        <CardHeader>
                            <CardTitle>{project.address}</CardTitle>
                            <CardDescription>B-Number: {project.bNumber || 'N/A'}</CardDescription>
                        </CardHeader>
                        <CardContent className="text-sm space-y-2">
                             <div><strong>Manager:</strong> {project.manager || 'N/A'}</div>
                             <div><strong>Created:</strong> {project.createdAt ? format(project.createdAt.toDate(), 'dd/MM/yyyy') : 'N/A'} by {project.createdBy || 'N/A'}</div>
                             <div><strong>Next Review:</strong> {project.nextReviewDate ? format(project.nextReviewDate.toDate(), 'dd/MM/yyyy') : 'N/A'}</div>
                        </CardContent>
                        <CardFooter>
                            <Button variant="outline" className="w-full" onClick={() => handleManageFiles(project)}>
                                <FolderOpen className="mr-2 h-4 w-4" />
                                Manage Files
                            </Button>
                        </CardFooter>
                    </Card>
                ))}
            </div>
        </>
      )}

      {selectedProject && <FileManagerDialog project={selectedProject} open={isFileManagerOpen} onOpenChange={setFileManagerOpen} userProfile={userProfile} />}
    </div>
  );
}
