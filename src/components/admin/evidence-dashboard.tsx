
'use client';

import { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, query, orderBy, doc, updateDoc, serverTimestamp, addDoc } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { db, storage } from '@/lib/firebase';
import type { Project, EvidenceChecklist, ProjectFile, UserProfile, EvidenceChecklistItem } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Building2, Search, Pencil, CheckCircle, XCircle, Download, Trash2, RotateCw, Camera, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { EvidenceChecklistManager } from '@/components/admin/evidence-checklist-manager';
import { cn } from '@/lib/utils';
import { Spinner } from '@/components/shared/spinner';
import { useUserProfile } from '@/hooks/use-user-profile';
import { useToast } from '@/hooks/use-toast';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { format, differenceInDays, differenceInHours, differenceInMinutes } from 'date-fns';
import { Dialog, DialogDescription, DialogHeader, DialogTitle, DialogContent, DialogClose } from '@/components/ui/dialog';
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from '@/components/ui/carousel';
import NextImage from 'next/image';
import { MultiPhotoCamera } from '@/components/shared/multi-photo-camera';

const isMatch = (checklistText: string, fileTag: string | undefined): boolean => {
    if (!fileTag || !checklistText) return false;

    const normalize = (text: string): string => {
        return text
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '') 
            .replace(/[\s-_]+/g, ' ') 
            .trim();
    }

    const normalizedChecklist = normalize(checklistText);
    const normalizedTag = normalize(fileTag);

    if (!normalizedChecklist) return false;

    const checklistWords = normalizedChecklist.split(' ');
    const tagWords = normalizedTag.split(' ');

    return checklistWords.every(checklistWord => tagWords.includes(checklistWord));
};


interface EvidenceReportGeneratorProps {
  project: Project;
  files: ProjectFile[];
  onGenerated: () => void;
  userProfile: UserProfile | null;
}

function EvidenceReportGenerator({ project, files, onGenerated, userProfile }: EvidenceReportGeneratorProps) {
  const [isGenerating, setIsGenerating] = useState(false);

  const generatePdf = async () => {
    setIsGenerating(true);

    const { default: jsPDF } = await import('jspdf');

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.width;
    const pageHeight = doc.internal.pageSize.height;
    const pageMargin = 15;
    
    // --- Logo Setup ---
    const logoSvg = `<svg width="28" height="28" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><g transform="translate(16,16)"><path d="M 0 -14 A 14 14 0 0 1 14 0 L 8 0 A 8 8 0 0 0 0 -8 Z" fill="#84cc16" transform="rotate(0)"/><path d="M 0 -14 A 14 14 0 0 1 14 0 L 8 0 A 8 8 0 0 0 0 -8 Z" fill="#22d3ee" transform="rotate(90)"/><path d="M 0 -14 A 14 14 0 0 1 14 0 L 8 0 A 8 8 0 0 0 0 -8 Z" fill="#f87171" transform="rotate(180)"/><path d="M 0 -14 A 14 14 0 0 1 14 0 L 8 0 A 8 8 0 0 0 0 -8 Z" fill="#fbbf24" transform="rotate(270)"/></g></svg>`;
    const logoDataUrl = `data:image/svg+xml;base64,${btoa(logoSvg)}`;
    
    const logoPngDataUrl: string = await new Promise((resolve, reject) => {
      const img = new window.Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 56;
        canvas.height = 56;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, 56, 56);
          resolve(canvas.toDataURL('image/png'));
        } else {
          reject(new Error('Failed to get canvas context'));
        }
      };
      img.onerror = () => reject(new Error('Failed to load SVG for conversion'));
      img.src = logoDataUrl;
    });

    // --- Header on Cover Page ---
    doc.setFillColor(241, 245, 249); // slate-100
    doc.rect(0, 0, pageWidth, 28, 'F');
    doc.addImage(logoPngDataUrl, 'PNG', pageMargin, 6, 16, 16);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(15, 23, 42); // slate-900
    doc.text('BROAD OAK GROUP', pageMargin + 22, 17);

    // --- Cover Page Content ---
    let currentY = 70;
    
    doc.setFontSize(32);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42); // slate-900
    doc.text('Evidence Report', pageWidth / 2, currentY, { align: 'center' });
    currentY += 20;

    doc.setFontSize(16);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(51, 65, 85); // slate-700
    const addressLines = doc.splitTextToSize(project.address, pageWidth - (pageMargin * 6));
    doc.text(addressLines, pageWidth / 2, currentY, { align: 'center' });
    currentY += (addressLines.length * 8) + 10;

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(100, 116, 139); // slate-500
    const detailText = `${project.contract || 'N/A Contract'} | ${project.eNumber || 'N/A E-Number'}`;
    doc.text(detailText, pageWidth / 2, currentY, { align: 'center' });

    const generatedOnText = `Generated on: ${format(new Date(), 'PPP')}`;
    const generatedByText = userProfile ? `Generated by: ${userProfile.name}` : '';

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(148, 163, 184); // slate-400
    doc.text(generatedOnText, pageWidth / 2, pageHeight - 25, { align: 'center' });
    if (generatedByText) {
        doc.text(generatedByText, pageWidth / 2, pageHeight - 20, { align: 'center' });
    }

    // --- Photo Pages ---
    const photos = files.filter(f => f.type?.startsWith('image/'));

    if (photos.length > 0) {
      const groupedPhotos = new Map<string, ProjectFile[]>();
      photos.forEach(photo => {
          const tag = photo.evidenceTag || 'Uncategorized';
          if (!groupedPhotos.has(tag)) {
              groupedPhotos.set(tag, []);
          }
          groupedPhotos.get(tag)!.push(photo);
      });
      const sortedGroups = new Map([...groupedPhotos.entries()].sort());

      doc.addPage();
      let finalY = pageMargin;

      const addPageIfNeeded = (requiredHeight: number) => {
          if (finalY + requiredHeight > pageHeight - pageMargin) {
              doc.addPage();
              finalY = pageMargin;
          }
      };

      for (const [tag, photosInGroup] of sortedGroups.entries()) {
          // --- NEW PROFESSIONAL TITLE ---
          const titleHeight = 10;
          const titlePadding = 3;
          
          addPageIfNeeded(titleHeight + (titlePadding * 2) + 12); // Add space for title block and margin
          
          // Background rectangle for the title
          doc.setFillColor(15, 23, 42); // slate-900 (dark, professional)
          doc.rect(pageMargin, finalY, pageWidth - (pageMargin * 2), titleHeight + titlePadding, 'F');
          
          // Title text
          doc.setFontSize(14);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(255, 255, 255); // White text
          doc.text(tag, pageMargin + titlePadding, finalY + (titleHeight + titlePadding) / 2, { 
              align: 'left', 
              baseline: 'middle' 
          });
          
          finalY += titleHeight + titlePadding + 12; // Move cursor down
          // --- END NEW TITLE ---

          for (const photo of photosInGroup) {
              try {
                  const imageUrl = `https://images.weserv.nl/?url=${encodeURIComponent(photo.url)}`;
                  const response = await fetch(imageUrl);
                  const blob = await response.blob();
                  const reader = new FileReader();
                  const dataUrl: string = await new Promise((resolve, reject) => {
                      reader.onload = () => resolve(reader.result as string);
                      reader.onerror = reject;
                      reader.readAsDataURL(blob);
                  });

                  const imgProps = doc.getImageProperties(dataUrl);
                  const imgWidth = pageWidth - (pageMargin * 2);
                  const imgHeight = (imgProps.height * imgWidth) / imgProps.width;
                  
                  const maxHeight = 110; // Max height per image to fit two
                  let renderHeight = imgHeight;
                  let renderWidth = imgWidth;

                  if (renderHeight > maxHeight) {
                      renderWidth = (renderWidth * maxHeight) / renderHeight;
                      renderHeight = maxHeight;
                  }
                  
                  const captionText = `${photo.evidenceTag ? `Tag: ${photo.evidenceTag}` : photo.name} - Uploaded by ${photo.uploaderName}`;
                  const captionLines = doc.splitTextToSize(captionText, renderWidth);
                  const captionHeight = (doc.getLineHeight() * captionLines.length) / doc.internal.scaleFactor;
                  const totalBlockHeight = renderHeight + captionHeight + 10;
                  
                  addPageIfNeeded(totalBlockHeight);
                  
                  const centeredX = (pageWidth - renderWidth) / 2;
                  doc.addImage(dataUrl, 'JPEG', centeredX, finalY, renderWidth, renderHeight);
                  finalY += renderHeight + 5;

                  doc.setFontSize(9);
                  doc.setTextColor(100, 116, 139);
                  doc.text(captionLines, centeredX, finalY);
                  finalY += captionHeight + 5;

              } catch (e) {
                console.error("Could not add image to PDF", e);
                addPageIfNeeded(10);
                doc.setFontSize(9);
                doc.setTextColor(255, 0, 0);
                doc.text(`Failed to load image: ${photo.name}`, pageMargin, finalY);
                finalY += 10;
              }
          }
           finalY += 10; // Space between groups
      }
    }
    
    doc.save(`evidence_${project.address.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`);
    setIsGenerating(false);
    onGenerated();
  };

  return (
    <Button onClick={generatePdf} disabled={isGenerating} size="sm" className="w-full text-xs px-2 gap-1.5">
      {isGenerating ? <Spinner /> : <><Download className="mr-2 h-4 w-4" /> Generate PDF</>}
    </Button>
  );
}

interface ProjectEvidenceCardProps {
  project: Project;
  checklist: EvidenceChecklist | undefined;
  files: ProjectFile[];
  loadingFiles: boolean;
  generatedPdfProjects: string[];
  onPdfGenerated: (projectId: string) => void;
  onResetStatus: (projectId: string) => void;
}

function ProjectEvidenceCard({ project, checklist, files, loadingFiles, generatedPdfProjects, onPdfGenerated, onResetStatus }: ProjectEvidenceCardProps) {
    const { userProfile } = useUserProfile();
    const { toast } = useToast();
    const [viewerOpen, setViewerOpen] = useState(false);
    const [selectedItem, setSelectedItem] = useState<{ text: string; photos: ProjectFile[] } | null>(null);
    const [enlargedPhoto, setEnlargedPhoto] = useState<ProjectFile | null>(null);

    const [isCameraOpen, setIsCameraOpen] = useState(false);
    const [selectedCameraItem, setSelectedCameraItem] = useState<{ text: string, count: number } | null>(null);
    const [isChecklistEditorOpen, setChecklistEditorOpen] = useState(false);
    
    const activeChecklistItems = useMemo(() => {
        return project.checklist ?? checklist?.items ?? [];
    }, [project.checklist, checklist]);

    const evidenceState = useMemo<'incomplete' | 'ready' | 'generated'>(() => {
        if (loadingFiles) return 'incomplete';

        const isChecklistMet = (() => {
            if (activeChecklistItems.length === 0) {
                return true;
            }
            return activeChecklistItems.every(item => {
                const requiredCount = item.photoCount || 1;
                const matchingFiles = files.filter(file => isMatch(item.text, file.evidenceTag));
                return matchingFiles.length >= requiredCount;
            });
        })();

        const isPdfGenerated = generatedPdfProjects.includes(project.id);

        if (!isChecklistMet) return 'incomplete';
        if (isPdfGenerated) return 'generated';
        return 'ready';
    }, [files, activeChecklistItems, loadingFiles, generatedPdfProjects, project.id]);

    const openDuration = useMemo(() => {
        if (!project.createdAt) return null;
        
        const now = new Date();
        const createdAt = project.createdAt.toDate();
        const minutes = differenceInMinutes(now, createdAt);

        if (minutes < 60) {
             return { value: minutes, unit: 'minute' };
        }

        const hours = differenceInHours(now, createdAt);
        if (hours < 24) {
            return { value: hours, unit: 'hour' };
        }
        
        const days = differenceInDays(now, createdAt);
        return { value: days, unit: 'day' };

    }, [project.createdAt]);

    const handleDeleteProject = async () => {
        if (!userProfile || !['admin', 'owner', 'manager', 'TLO'].includes(userProfile.role)) {
            toast({ variant: 'destructive', title: 'Permission Denied', description: 'You do not have permission to delete projects.' });
            return;
        }

        toast({ title: "Scheduling Deletion...", description: `Project will be removed from this view and permanently deleted in 7 days.` });

        try {
            const projectRef = doc(db, 'projects', project.id);
            await updateDoc(projectRef, {
                deletionScheduledAt: serverTimestamp()
            });
            toast({ title: "Success", description: "Project scheduled for deletion." });
        } catch (error: any) {
            console.error("Error scheduling project for deletion:", error);
            toast({
                variant: 'destructive',
                title: 'Scheduling Failed',
                description: error.message || 'An unknown error occurred.'
            });
        }
    };

    const evidenceStatus = useMemo(() => {
        if (activeChecklistItems.length === 0) return [];
        return activeChecklistItems.map(item => {
            const matchingFiles = files.filter(file => file.type?.startsWith('image/') && isMatch(item.text, file.evidenceTag));
            const requiredCount = item.photoCount || 1;
            const isComplete = matchingFiles.length >= requiredCount;
            const displayCount = isComplete ? requiredCount : matchingFiles.length;
            return {
                text: item.text,
                isComplete,
                photoCount: requiredCount,
                uploadedCount: matchingFiles.length,
                displayCount,
                photos: matchingFiles
            };
        });
    }, [files, activeChecklistItems]);

    const handleViewPhotos = (itemText: string, photos: ProjectFile[]) => {
        if (photos.length > 0) {
            setSelectedItem({ text: itemText, photos });
            setViewerOpen(true);
        }
    };

    const handleTakePhoto = (itemText: string, requiredCount: number) => {
        setSelectedCameraItem({ text: itemText, count: requiredCount });
        setIsCameraOpen(true);
    };

    const handleUploadFromCamera = async (filesToUpload: File[]) => {
        if (!userProfile || !selectedCameraItem) return;

        toast({ title: 'Uploading photos...', description: 'Please wait.' });

        const uploadPromises = filesToUpload.map(file => {
            const storagePath = `project_files/${project.id}/${Date.now()}-${file.name}`;
            const storageRef = ref(storage, storagePath);
            
            const uploadTask = uploadBytesResumable(storageRef, file);

            return new Promise<void>((resolve, reject) => {
                uploadTask.on(
                    'state_changed',
                    null,
                    (error) => reject(error),
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
                                evidenceTag: selectedCameraItem.text || ''
                            });
                            resolve();
                        } catch (dbError) {
                            reject(dbError);
                        }
                    }
                );
            });
        });

        try {
            await Promise.all(uploadPromises);
            toast({ title: 'Success', description: `${filesToUpload.length} photo(s) uploaded.` });
        } catch (error) {
            console.error("Error uploading photos from camera:", error);
            toast({ variant: 'destructive', title: 'Upload Failed', description: 'One or more photos failed to upload.' });
        }
    };


    const cardColorClass = {
        incomplete: 'bg-red-800 border-red-950',
        ready: 'bg-orange-600 border-orange-800',
        generated: 'bg-green-700 border-green-900',
    }[evidenceState];

    const textColorClass = 'text-white';

    return (
        <>
            <Card className={cn("hover:shadow-md transition-shadow flex flex-col", cardColorClass)}>
                <CardHeader className="p-4 pb-2">
                    <div className="flex justify-between items-start gap-2">
                        <CardTitle className={cn("text-sm font-semibold leading-tight flex-grow", textColorClass)}>{project.address}</CardTitle>
                        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-white/70 hover:text-white" onClick={() => setChecklistEditorOpen(true)}>
                            <Pencil className="h-3 w-3" />
                        </Button>
                    </div>
                    {project.eNumber && <CardDescription className={cn("text-xs pt-1 opacity-80", textColorClass)}>{project.eNumber}</CardDescription>}
                </CardHeader>
                <CardContent className="p-4 pt-2 flex-grow flex flex-col justify-between">
                    {loadingFiles ? (
                        <div className="flex justify-center items-center h-16">
                            <Spinner size="sm" />
                        </div>
                    ) : (
                        <div>
                            {evidenceStatus.length > 0 ? (
                                <div className="space-y-1">
                                    {evidenceStatus.map(item => (
                                        <div key={item.text} className={cn("flex items-center gap-2 text-xs", item.isComplete ? cn(textColorClass, "opacity-70") : cn("font-semibold", textColorClass))}>
                                            {item.isComplete ?
                                                <button onClick={() => handleViewPhotos(item.text, item.photos)} className="flex items-center gap-2 text-left w-full hover:underline">
                                                    <CheckCircle className="h-3 w-3 opacity-90 shrink-0" />
                                                    <span className="truncate">{item.text} ({item.displayCount}/{item.photoCount})</span>
                                                </button>
                                                :
                                                <div className="flex items-center justify-between gap-2 text-left w-full">
                                                  <div className="flex items-center gap-2">
                                                    <XCircle className="h-3 w-3 shrink-0" />
                                                    <span className="truncate">{item.text} ({item.displayCount}/{item.photoCount})</span>
                                                  </div>
                                                  <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-white" onClick={() => handleTakePhoto(item.text, item.photoCount)}>
                                                      <Camera className="h-4 w-4" />
                                                  </Button>
                                                </div>
                                            }
                                        </div>
                                    ))}
                                </div>
                            ) : <p className={cn("text-xs italic", textColorClass)}>No evidence checklist for this contract.</p>}
                        </div>
                    )}
                    {openDuration && (
                        <div className="text-right text-xs mt-2 opacity-80 text-white">
                            <span className="font-bold">{openDuration.value}</span> {openDuration.unit}{openDuration.value === 1 ? '' : 's'} open
                        </div>
                    )}
                </CardContent>
                <CardFooter className="p-2 border-t mt-auto grid gap-2">
                     <div className="space-y-2">
                        {evidenceState !== 'incomplete' && (
                            <EvidenceReportGenerator project={project} files={files} onGenerated={() => onPdfGenerated(project.id)} userProfile={userProfile} />
                        )}
                        {evidenceState === 'generated' && (
                            <div className="grid grid-cols-2 gap-2">
                                <Button variant="secondary" size="sm" className="text-xs px-2 gap-1.5" onClick={() => onResetStatus(project.id)}>
                                    <RotateCw className="h-4 w-4" /> More Evidence
                                </Button>
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button variant="destructive" size="sm" className="text-xs px-2 gap-1.5">
                                            <Trash2 className="h-4 w-4" /> Delete
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                                            <AlertDialogDescription>This action schedules the project for permanent deletion in 7 days.</AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                            <AlertDialogAction onClick={handleDeleteProject} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Schedule Deletion</AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            </div>
                        )}
                    </div>
                </CardFooter>
            </Card>

            {selectedCameraItem && (
                <MultiPhotoCamera
                    open={isCameraOpen}
                    onOpenChange={setIsCameraOpen}
                    requiredCount={selectedCameraItem.count}
                    onUploadComplete={handleUploadFromCamera}
                    taskName={selectedCameraItem.text}
                />
            )}

            {selectedItem && (
                <Dialog open={viewerOpen} onOpenChange={setViewerOpen}>
                    <DialogContent className="max-w-4xl">
                        <DialogHeader>
                            <DialogTitle>Photos for: {selectedItem.text}</DialogTitle>
                            <DialogDescription>
                                {selectedItem.photos.length} photo(s) found for this evidence item on project: {project.address}.
                            </DialogDescription>
                        </DialogHeader>
                        <Carousel className="w-full">
                            <CarouselContent>
                                {selectedItem.photos.map((photo) => (
                                    <CarouselItem key={photo.id}>
                                        <div className="p-1">
                                            <Card>
                                                <CardContent 
                                                    className="flex aspect-video items-center justify-center p-0 relative overflow-hidden rounded-lg cursor-pointer group"
                                                    onClick={() => setEnlargedPhoto(photo)}
                                                >
                                                    <NextImage
                                                        src={`https://images.weserv.nl/?url=${encodeURIComponent(photo.url)}`}
                                                        alt={photo.name}
                                                        fill
                                                        className="object-contain transition-transform duration-300 group-hover:scale-105"
                                                    />
                                                </CardContent>
                                                 <CardFooter className="flex-col items-start text-sm text-muted-foreground p-3">
                                                    <p><strong>File:</strong> {photo.name}</p>
                                                    <p><strong>Uploaded by:</strong> {photo.uploaderName}</p>
                                                    <p><strong>Date:</strong> {photo.uploadedAt ? format(photo.uploadedAt.toDate(), 'PPP p') : 'N/A'}</p>
                                                </CardFooter>
                                            </Card>
                                        </div>
                                    </CarouselItem>
                                ))}
                            </CarouselContent>
                            <CarouselPrevious />
                            <CarouselNext />
                        </Carousel>
                    </DialogContent>
                </Dialog>
            )}

            {enlargedPhoto && (
                <Dialog open={!!enlargedPhoto} onOpenChange={() => setEnlargedPhoto(null)}>
                    <DialogContent 
                        showCloseButton={false}
                        className="w-screen h-screen max-w-full max-h-full p-0 bg-black/80 border-none shadow-none flex items-center justify-center"
                    >
                         <div className="relative w-full h-full">
                            <NextImage
                                src={`https://images.weserv.nl/?url=${encodeURIComponent(enlargedPhoto.url)}`}
                                alt={enlargedPhoto.name}
                                fill
                                className="object-contain"
                            />
                         </div>
                         <DialogClose asChild>
                            <Button variant="ghost" size="icon" className="absolute top-4 right-4 h-12 w-12 rounded-full bg-black/50 text-white hover:bg-black/75 hover:text-white">
                                <X className="h-8 w-8" />
                            </Button>
                         </DialogClose>
                    </DialogContent>
                </Dialog>
            )}
            
            <EvidenceChecklistManager
                open={isChecklistEditorOpen}
                onOpenChange={setChecklistEditorOpen}
                projectId={project.id}
                contractChecklist={checklist?.items}
            />
        </>
    );
}


export function EvidenceDashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [evidenceChecklists, setEvidenceChecklists] = useState<Map<string, EvidenceChecklist>>(new Map());
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingChecklist, setEditingChecklist] = useState<string | null>(null);

  const [filesByProject, setFilesByProject] = useState<Map<string, ProjectFile[]>>(new Map());
  const LOCAL_STORAGE_KEY = 'evidence_pdf_generated_projects_v5';
  const [generatedPdfProjects, setGeneratedPdfProjects] = useState<string[]>([]);

  useEffect(() => {
    try {
        const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (stored) {
            setGeneratedPdfProjects(JSON.parse(stored));
        }
    } catch (e) {
        console.error("Failed to load generated PDF list", e);
    }
  }, []);
  
  const onPdfGenerated = (projectId: string) => {
    setGeneratedPdfProjects(prev => {
        const newGenerated = [...new Set([...prev, projectId])];
        try {
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(newGenerated));
        } catch (e) {
            console.error("Failed to write to local storage", e);
        }
        return newGenerated;
    });
  }
  
   const onResetStatus = (projectId: string) => {
    setGeneratedPdfProjects(prev => {
        const newGenerated = prev.filter(id => id !== projectId);
        try {
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(newGenerated));
        } catch (e) {
            console.error("Failed to write to local storage", e);
        }
        return newGenerated;
    });
  };

  useEffect(() => {
    setLoading(true);
    const projectsQuery = query(collection(db, 'projects'), orderBy('createdAt', 'desc'));
    const unsubProjects = onSnapshot(projectsQuery, 
      (snapshot) => {
          const allProjects = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project));
          const activeProjects = allProjects.filter(p => !p.deletionScheduledAt);
          setProjects(activeProjects);
          if (snapshot.docs.length === 0) setLoading(false);
      },
      (err) => {
          console.error("Error fetching projects:", err);
          setLoading(false);
      }
    );

    const checklistsQuery = query(collection(db, 'evidence_checklists'));
    const unsubChecklists = onSnapshot(checklistsQuery, (snapshot) => {
        const checklistsMap = new Map<string, EvidenceChecklist>();
        snapshot.docs.forEach(doc => checklistsMap.set(doc.id, doc.data() as EvidenceChecklist));
        setEvidenceChecklists(checklistsMap);
    });

    return () => {
        unsubProjects();
        unsubChecklists();
    };
  }, []);

  useEffect(() => {
    if(projects.length === 0) {
        setFilesByProject(new Map());
        return;
    };

    const unsubscribers = projects.map(project => {
        const q = query(collection(db, `projects/${project.id}/files`));
        return onSnapshot(q, (snapshot) => {
            const files = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ProjectFile));
            setFilesByProject(prev => new Map(prev).set(project.id, files));
            
            const isGenerated = generatedPdfProjects.includes(project.id);
            if (isGenerated) {
                 const activeChecklistItems = project.checklist ?? evidenceChecklists.get(project.contract || '')?.items ?? [];
                 const isChecklistMet = activeChecklistItems.length === 0 ||
                    activeChecklistItems.every(item => {
                        const requiredCount = item.photoCount || 1;
                        const matchingFiles = files.filter(file => isMatch(item.text, file.evidenceTag));
                        return matchingFiles.length >= requiredCount;
                    });
                if (!isChecklistMet) {
                    onResetStatus(project.id);
                }
            }
        });
    });

    return () => unsubscribers.forEach(unsub => unsub());
  }, [projects, evidenceChecklists, generatedPdfProjects]);

  useEffect(() => {
    if (projects.length > 0 && filesByProject.size < projects.length) {
        setLoading(true);
    } else {
        setLoading(false);
    }
  }, [projects, filesByProject]);


  const filteredProjects = useMemo(() => {
    if (!searchTerm) return projects;
    return projects.filter(project =>
      project.address.toLowerCase().includes(searchTerm.toLowerCase()) ||
      project.contract?.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [projects, searchTerm]);

  const groupedProjects = useMemo(() => {
    if (loading) return [];

    const getDaysOpen = (project: Project): number => {
        if (!project.createdAt) return 0;
        return differenceInDays(new Date(), project.createdAt.toDate());
    }

    const enrichedProjects = filteredProjects.map(project => {
        const contractChecklist = evidenceChecklists.get(project.contract || '');
        const activeChecklistItems = project.checklist ?? contractChecklist?.items ?? [];
        const projectFiles = filesByProject.get(project.id) || [];
        
        const isChecklistMet = activeChecklistItems.length === 0 || 
            activeChecklistItems.every(item => {
                const requiredCount = item.photoCount || 1;
                const matchingFiles = projectFiles.filter(file => isMatch(item.text, file.evidenceTag));
                return matchingFiles.length >= requiredCount;
            });

        let evidenceState: 'incomplete' | 'ready' | 'generated' = 'incomplete';
        if (isChecklistMet) {
            if (generatedPdfProjects.includes(project.id)) {
                evidenceState = 'generated';
            } else {
                evidenceState = 'ready';
            }
        }

        return {
            ...project,
            evidenceState,
            daysOpen: getDaysOpen(project)
        };
    });

    const priorityOrder = { 'ready': 1, 'incomplete': 2, 'generated': 3 };
    enrichedProjects.sort((a, b) => {
        const statePriorityA = priorityOrder[a.evidenceState];
        const statePriorityB = priorityOrder[b.evidenceState];

        if (statePriorityA !== statePriorityB) {
            return statePriorityA - statePriorityB;
        }
        
        return b.daysOpen - a.daysOpen;
    });

    const groups: { [key: string]: typeof enrichedProjects } = {};
    enrichedProjects.forEach(project => {
        const groupName = project.contract || 'Uncategorized';
        if (!groups[groupName]) {
            groups[groupName] = [];
        }
        groups[groupName].push(project);
    });
    
    const activeGroups = Object.entries(groups).filter(([contractName, projectGroup]) => {
      return projectGroup.some(p => p.evidenceState !== 'generated');
    });

    return activeGroups.sort(([a], [b]) => a.localeCompare(b));
  }, [filteredProjects, filesByProject, evidenceChecklists, loading, generatedPdfProjects]);


  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                  <CardTitle>Evidence Dashboard</CardTitle>
                  <CardDescription>
                  Overview of all project sites. New sites from imports will appear here.
                  </CardDescription>
              </div>
              <div className="relative w-full sm:w-auto">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                      placeholder="Search by address..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full sm:w-64 pl-10"
                  />
              </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-8">
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {Array.from({ length: 10 }).map((_, i) => (
                <Skeleton key={i} className="h-40 w-full" />
              ))}
            </div>
          ) : groupedProjects.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 text-center h-96">
              <Building2 className="mx-auto h-12 w-12 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-semibold">No Active Projects Found</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Projects will appear here once they are created. Completed contract groups are hidden.
              </p>
            </div>
          ) : (
            groupedProjects.map(([contractName, projectGroup]) => (
              <div key={contractName}>
                <div className="flex items-center gap-2 mb-4">
                    <h2 className="text-xl font-semibold capitalize">{contractName}</h2>
                    <Button variant="ghost" size="icon" onClick={() => setEditingChecklist(contractName)}>
                        <Pencil className="h-4 w-4 text-muted-foreground" />
                    </Button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                  {projectGroup.map(project => (
                    <ProjectEvidenceCard 
                        key={project.id}
                        project={project}
                        checklist={evidenceChecklists.get(project.contract || '')}
                        files={filesByProject.get(project.id) || []}
                        loadingFiles={loading}
                        generatedPdfProjects={generatedPdfProjects}
                        onPdfGenerated={onPdfGenerated}
                        onResetStatus={onResetStatus}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
      {editingChecklist && (
        <EvidenceChecklistManager
            contractName={editingChecklist}
            open={!!editingChecklist}
            onOpenChange={(open) => !open && setEditingChecklist(null)}
        />
       )}
    </>
  );
}
