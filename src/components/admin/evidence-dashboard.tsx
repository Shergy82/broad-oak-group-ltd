

'use client';

import { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, query, orderBy, doc, updateDoc, serverTimestamp, addDoc, deleteField, where, getDocs } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { db, storage } from '@/lib/firebase';
import type { Project, EvidenceChecklist, ProjectFile, UserProfile, EvidenceChecklistItem, Shift } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Building2, Search, Pencil, CheckCircle, XCircle, Download, Trash2, RotateCw, Camera, X, Undo2, ImageIcon, Eye, EyeOff } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { EvidenceChecklistManager } from '@/components/admin/evidence-checklist-manager';
import { cn } from '@/lib/utils';
import { Spinner } from '@/components/shared/spinner';
import { useUserProfile } from '@/hooks/use-user-profile';
import { useToast } from '@/hooks/use-toast';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { format, differenceInDays, differenceInHours, differenceInMinutes, isBefore } from 'date-fns';
import { Dialog, DialogDescription, DialogHeader, DialogTitle, DialogContent, DialogClose } from '@/components/ui/dialog';
import { MultiPhotoCamera } from '@/components/shared/multi-photo-camera';
import { useDepartmentFilter } from '@/hooks/use-department-filter';
import Image from 'next/image';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { useAllUsers } from '@/hooks/use-all-users';


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
    const detailText = `${project.contract || 'N/A Contract'} | ${project.eNumber || 'N/A Number'}`;
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
                  const imageUrl = `/api/file?path=${encodeURIComponent(photo.fullPath)}`;
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
    <Button onClick={generatePdf} disabled={isGenerating} size="sm" className="w-full text-xs px-1 py-1 h-14 flex-col justify-center">
      {isGenerating ? <Spinner /> : <>
        <Download className="h-4 w-4" />
        <span>Generate PDF</span>
      </>}
    </Button>
  );
}

interface ProjectEvidenceCardProps {
  project: Project & { evidenceState: 'incomplete' | 'ready' | 'completed' };
  checklist: EvidenceChecklist | undefined;
  files: ProjectFile[];
  loadingFiles: boolean;
  onMarkAsComplete: (projectId: string) => Promise<void>;
  onResetStatus: (projectId: string) => Promise<void>;
  onScheduleForDeletion: (projectId: string) => void;
}

function ProjectEvidenceCard({ project, checklist, files, loadingFiles, onMarkAsComplete, onResetStatus, onScheduleForDeletion }: ProjectEvidenceCardProps) {
    const { userProfile } = useUserProfile();
    const { toast } = useToast();
    const [isGalleryOpen, setIsGalleryOpen] = useState(false);
    const [viewingFile, setViewingFile] = useState<ProjectFile | null>(null);

    const [isCameraOpen, setIsCameraOpen] = useState(false);
    const [selectedCameraItem, setSelectedCameraItem] = useState<{ text: string, count: number } | null>(null);
    const [isChecklistEditorOpen, setChecklistEditorOpen] = useState(false);

    const imageFiles = useMemo(() => files.filter(f => f.type?.startsWith('image/')), [files]);
    
    const { evidenceState } = project;

    const activeChecklistItems = useMemo(() => {
        return project.checklist ?? checklist?.items ?? [];
    }, [project.checklist, checklist]);

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

    const completedCount = useMemo(() => evidenceStatus.filter(item => item.isComplete).length, [evidenceStatus]);
    const totalCount = evidenceStatus.length;

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
        completed: 'bg-green-700 border-green-900',
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
                    {project.eNumber && <p className={cn("text-lg font-bold pt-1", textColorClass)}>{project.eNumber}</p>}
                </CardHeader>
                
                 <CardContent className="p-0 flex-grow">
                    <Accordion type="single" collapsible className="w-full">
                        <AccordionItem value="item-1" className="border-none">
                            <AccordionTrigger className="px-4 py-2 hover:no-underline [&[data-state=open]>svg]:text-white">
                                <div className="flex justify-between items-center w-full">
                                    <span className={cn("text-sm font-semibold", textColorClass)}>
                                        Checklist Progress
                                    </span>
                                    <Badge variant={completedCount === totalCount && totalCount > 0 ? "default" : "secondary"} className={cn(completedCount === totalCount && totalCount > 0 ? "bg-green-500/80 border-green-400" : "")}>
                                        {completedCount} / {totalCount}
                                    </Badge>
                                </div>
                            </AccordionTrigger>
                            <AccordionContent className="px-4 pt-0 pb-4">
                                {loadingFiles ? (
                                    <div className="flex justify-center items-center h-16">
                                        <Spinner size="sm" />
                                    </div>
                                ) : (
                                    <div>
                                        {evidenceStatus.length > 0 ? (
                                            <div className="space-y-1">
                                                {evidenceStatus.map(item => (
                                                    <div key={item.text} className={cn("flex items-center justify-between gap-2 text-xs", item.isComplete ? cn(textColorClass, "opacity-70") : cn("font-semibold", textColorClass))}>
                                                        <div className="flex items-center gap-2">
                                                            {item.isComplete ? (
                                                                <CheckCircle className="h-3 w-3 opacity-90 shrink-0" />
                                                            ) : (
                                                                <XCircle className="h-3 w-3 shrink-0" />
                                                            )}
                                                            <span className="truncate">{item.text} ({item.displayCount}/{item.photoCount})</span>
                                                        </div>
                                                        {!item.isComplete && item.photoCount > 0 && (
                                                            <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-white" onClick={() => handleTakePhoto(item.text, item.photoCount)}>
                                                                <Camera className="h-4 w-4" />
                                                            </Button>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        ) : <p className={cn("text-xs italic text-center py-2", textColorClass)}>No evidence checklist for this contract.</p>}
                                    </div>
                                )}
                            </AccordionContent>
                        </AccordionItem>
                    </Accordion>
                </CardContent>

                <div className="px-4 pb-2 text-right text-xs mt-auto opacity-80 text-white">
                    {openDuration && (
                        <span>
                            <span className="font-bold">{openDuration.value}</span> {openDuration.unit}{openDuration.value === 1 ? '' : 's'} open
                        </span>
                    )}
                </div>

                <CardFooter className="p-2 border-t mt-auto">
                     <div className="grid grid-cols-3 gap-2 w-full">
                        <Button variant="secondary" size="sm" className="text-xs px-1 py-1 h-14 w-full flex-col justify-center" onClick={() => setIsGalleryOpen(true)} disabled={imageFiles.length === 0}>
                            <ImageIcon className="h-4 w-4"/>
                            <span>View Photos</span>
                        </Button>
                        
                        {evidenceState === 'incomplete' && (
                           <AlertDialog>
                                <AlertDialogTrigger asChild>
                                    <Button variant="secondary" size="sm" className="col-span-2 text-xs px-1 py-1 h-14 w-full flex-col justify-center">
                                        <CheckCircle className="h-4 w-4 text-green-600"/>
                                        <span>Force Complete</span>
                                    </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                    <AlertDialogHeader>
                                        <AlertDialogTitle>Manually Complete Evidence?</AlertDialogTitle>
                                        <AlertDialogDescription>
                                            This will mark the evidence as complete. This action can be undone later if more evidence is needed.
                                        </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                        <AlertDialogAction onClick={() => onMarkAsComplete(project.id)}>
                                            Confirm
                                        </AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                        )}

                        {evidenceState === 'ready' && (
                            <div className="col-span-2 grid grid-cols-2 gap-2">
                                <EvidenceReportGenerator project={project} files={files} onGenerated={() => onMarkAsComplete(project.id)} userProfile={userProfile} />
                                <Button variant="secondary" size="sm" className="text-xs px-1 py-1 h-14 w-full flex-col justify-center" onClick={() => onMarkAsComplete(project.id)}>
                                    <CheckCircle className="h-4 w-4" />
                                    <span>Mark Complete</span>
                                </Button>
                            </div>
                        )}
                        
                        {evidenceState === 'completed' && (
                            <div className="col-span-2 grid grid-cols-2 gap-2">
                                <Button variant="secondary" size="sm" className="text-xs px-1 py-1 h-14 w-full flex-col justify-center" onClick={() => onResetStatus(project.id)}>
                                    <RotateCw className="h-4 w-4" />
                                    <span>More Evidence</span>
                                </Button>
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button variant="destructive" size="sm" className="text-xs px-1 py-1 h-14 w-full flex-col justify-center">
                                            <Trash2 className="h-4 w-4" />
                                            <span>Remove</span>
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>Schedule Project for Deletion?</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                This will schedule the project for permanent deletion in 7 days and remove it from this dashboard. This action can be undone from the Project Management page.
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                            <AlertDialogAction onClick={() => onScheduleForDeletion(project.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                                Schedule Deletion
                                            </AlertDialogAction>
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

            <Dialog open={isGalleryOpen} onOpenChange={setIsGalleryOpen}>
                <DialogContent className="max-w-6xl">
                    <DialogHeader>
                        <DialogTitle>Photos for: {project.address}</DialogTitle>
                        <DialogDescription>{imageFiles.length} photo(s) found for this project.</DialogDescription>
                    </DialogHeader>
                     {imageFiles.length > 0 ? (
                        <ScrollArea className="h-[70vh] rounded-md border p-4">
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                                {imageFiles.map((photo) => (
                                    <div key={photo.id} className="relative aspect-square group cursor-pointer rounded-md overflow-hidden" onClick={() => setViewingFile(photo)}>
                                        <Image
                                            src={`/api/file?path=${encodeURIComponent(photo.fullPath)}`}
                                            alt={photo.name}
                                            fill
                                            className="object-cover transition-transform group-hover:scale-105"
                                        />
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
                                            <span className="text-white text-xs text-left line-clamp-2">{photo.name}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </ScrollArea>
                    ) : (
                        <p className="text-center text-muted-foreground py-10">No photos to display.</p>
                    )}
                </DialogContent>
            </Dialog>
            
            <EvidenceChecklistManager
                open={isChecklistEditorOpen}
                onOpenChange={setChecklistEditorOpen}
                projectId={project.id}
                contractChecklist={checklist?.items}
                allChecklists={new Map()}
            />

            <Dialog open={!!viewingFile} onOpenChange={() => setViewingFile(null)}>
                <DialogContent className="max-w-[90vw] max-h-[90vh] flex items-center justify-center p-2 bg-transparent border-none shadow-none">
                    {viewingFile && (
                        <img
                            src={`/api/file?path=${encodeURIComponent(viewingFile.fullPath)}`}
                            alt={viewingFile.name}
                            className="object-contain max-w-[90vw] max-h-[90vh] rounded-lg"
                        />
                    )}
                    <DialogClose asChild>
                        <Button variant="ghost" size="icon" className="absolute right-2 top-2 z-10 bg-black/50 text-white rounded-full h-8 w-8 hover:bg-black/70 hover:text-white">
                            <X className="h-4 w-4" />
                        </Button>
                    </DialogClose>
                </DialogContent>
            </Dialog>
        </>
    );
}


export function EvidenceDashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [allShifts, setAllShifts] = useState<Shift[]>([]);
  const [evidenceChecklists, setEvidenceChecklists] = useState<Map<string, EvidenceChecklist>>(new Map());
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingChecklist, setEditingChecklist] = useState<string | null>(null);
  const { userProfile } = useUserProfile();
  const { users } = useAllUsers();
  const { toast } = useToast();
  const { selectedDepartments } = useDepartmentFilter();
  const isOwner = userProfile?.role === 'owner';

  const [filesByProject, setFilesByProject] = useState<Map<string, ProjectFile[]>>(new Map());
  const LS_HIDDEN_CONTRACTS_KEY = 'evidence_dashboard_hidden_contracts_v1';
  const [hiddenContracts, setHiddenContracts] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
        const storedHidden = localStorage.getItem(LS_HIDDEN_CONTRACTS_KEY);
        if (storedHidden) {
            setHiddenContracts(new Set(JSON.parse(storedHidden)));
        }
    } catch (e) {
        console.error("Failed to load project lists from local storage", e);
    }
  }, []);
  
  const handleMarkAsComplete = async (projectId: string) => {
    try {
        const projectRef = doc(db, 'projects', projectId);
        await updateDoc(projectRef, {
            evidenceStatus: 'completed'
        });
        toast({ title: 'Success', description: 'Project evidence has been marked as complete.' });
    } catch (error: any) {
        toast({ variant: 'destructive', title: 'Update Failed', description: error.message || 'Could not update project status.' });
    }
  };
  
   const onResetStatus = async (projectId: string) => {
    try {
        const projectRef = doc(db, 'projects', projectId);
        await updateDoc(projectRef, {
            evidenceStatus: deleteField()
        });
        toast({ title: 'Project Re-opened', description: 'Project evidence status has been reset.' });
    } catch (error: any) {
        toast({ variant: 'destructive', title: 'Update Failed', description: error.message || 'Could not update project status.' });
    }
  };

  const handleScheduleForDeletion = async (projectId: string) => {
    if (!userProfile || !['admin', 'owner', 'manager', 'TLO'].includes(userProfile.role)) {
        toast({ variant: 'destructive', title: 'Permission Denied' });
        return;
    }
    toast({ title: 'Scheduling Deletion...', description: 'Project will be permanently deleted in 7 days.' });
    try {
        const projectRef = doc(db, 'projects', projectId);
        await updateDoc(projectRef, {
            deletionScheduledAt: serverTimestamp()
        });

        toast({ title: 'Success', description: 'Project scheduled for deletion.' });

    } catch (error: any) {
        console.error("Error scheduling project for deletion:", error);
        toast({
            variant: 'destructive',
            title: 'Deletion Failed',
            description: error.message || 'An unknown error occurred.'
        });
    }
  };

  const toggleContractVisibility = (contractName: string) => {
    setHiddenContracts(prev => {
        const newSet = new Set(prev);
        if (newSet.has(contractName)) {
            newSet.delete(contractName);
        } else {
            newSet.add(contractName);
        }
        try {
            localStorage.setItem(LS_HIDDEN_CONTRACTS_KEY, JSON.stringify(Array.from(newSet)));
        } catch (e) {
            console.error("Failed to save hidden contracts to local storage", e);
        }
        return newSet;
    });
  };

  const hiddenContractsList = useMemo(() => {
      return Array.from(hiddenContracts).sort();
  }, [hiddenContracts]);

  // Unified data fetching
  useEffect(() => {
    if (!userProfile) return;
    setLoading(true);

    const projectsQuery = query(collection(db, 'projects'), orderBy('createdAt', 'desc'));
    const unsubProjects = onSnapshot(projectsQuery, (snapshot) => {
        setProjects(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)));
    }, (err) => {
        console.error("Error fetching projects:", err);
        toast({ variant: 'destructive', title: 'Error', description: 'Could not fetch projects.' });
    });

    const shiftsQuery = query(collection(db, 'shifts'));
    const unsubShifts = onSnapshot(shiftsQuery, (snapshot) => {
        setAllShifts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Shift)));
    }, (err) => {
        console.error("Error fetching shifts:", err);
        toast({ variant: 'destructive', title: 'Error', description: 'Could not fetch shifts.' });
    });

    const checklistsQuery = query(collection(db, 'evidence_checklists'));
    const unsubChecklists = onSnapshot(checklistsQuery, (snapshot) => {
        const checklistsMap = new Map<string, EvidenceChecklist>();
        snapshot.docs.forEach(doc => checklistsMap.set(doc.id, doc.data() as EvidenceChecklist));
        setEvidenceChecklists(checklistsMap);
    });

    // We can set loading to false here, as file fetching is secondary
    setLoading(false);

    return () => {
        unsubProjects();
        unsubShifts();
        unsubChecklists();
    };
}, [userProfile, toast]);

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
        });
    });

    return () => unsubscribers.forEach(unsub => unsub());
  }, [projects]);
  
  const relevantProjects = useMemo(() => {
    if (!userProfile) return [];

    let relevantProjectAddresses = new Set<string>();
    
    // For non-owners, figure out which projects they should see.
    if (!isOwner) {
        // 1. Projects in their own department
        projects.forEach(p => {
            if (p.department === userProfile.department) {
                relevantProjectAddresses.add(p.address);
            }
        });
        // 2. Projects they have shifts for (cross-department)
        allShifts.forEach(s => {
            if (s.userId === userProfile.uid && s.address) {
                relevantProjectAddresses.add(s.address);
            }
        });
    }

    const filtered = projects.filter(project => {
        if (isOwner) {
             // Owners see projects based on the department filter
            if (selectedDepartments.size > 0) {
                return project.department && selectedDepartments.has(project.department);
            }
            return true; // Or all projects if no filter
        } else {
            // Non-owners see projects if the address is in their relevant set
            return relevantProjectAddresses.has(project.address);
        }
    });
    
    // Final search term filter
    if (!searchTerm) return filtered;
    return filtered.filter(project =>
      project.address.toLowerCase().includes(searchTerm.toLowerCase()) ||
      project.contract?.toLowerCase().includes(searchTerm.toLowerCase())
    );

  }, [projects, allShifts, userProfile, isOwner, selectedDepartments, searchTerm]);


  const groupedProjects = useMemo(() => {
    if (loading) return [];

    const getDaysOpen = (project: Project): number => {
        if (!project.createdAt) return 0;
        return differenceInDays(new Date(), project.createdAt.toDate());
    }

    const enrichedProjects = relevantProjects
    .filter(p => !p.deletionScheduledAt)
    .map(project => {
        const contractChecklist = evidenceChecklists.get(project.contract || '');
        const activeChecklistItems = project.checklist ?? contractChecklist?.items ?? [];
        const projectFiles = filesByProject.get(project.id) || [];
        
        let evidenceState: 'incomplete' | 'ready' | 'completed' = 'incomplete';
        if (project.evidenceStatus === 'completed') {
            evidenceState = 'completed';
        } else {
            const isChecklistMet = activeChecklistItems.length === 0 || 
                activeChecklistItems.every(item => {
                    const requiredCount = item.photoCount || 1;
                    const matchingFiles = projectFiles.filter(file => isMatch(item.text, file.evidenceTag));
                    return matchingFiles.length >= requiredCount;
                });
            
            if (isChecklistMet) {
                evidenceState = 'ready';
            }
        }

        return {
            ...project,
            evidenceState,
            daysOpen: getDaysOpen(project)
        };
    });

    const priorityOrder = { 'ready': 1, 'incomplete': 2, 'completed': 3 };
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
    
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [relevantProjects, filesByProject, evidenceChecklists, loading]);
  
  const visibleGroups = useMemo(() => groupedProjects.filter(([name]) => !hiddenContracts.has(name)), [groupedProjects, hiddenContracts]);


  return (
    <>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div/>
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
      
      <div className="space-y-8 mt-4">
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {Array.from({ length: 10 }).map((_, i) => (
                <Skeleton key={i} className="h-40 w-full" />
              ))}
            </div>
          ) : visibleGroups.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 text-center h-96">
              <Building2 className="mx-auto h-12 w-12 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-semibold">No Projects Found</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Projects will appear here once they are created, for example, via the shift import process.
              </p>
            </div>
          ) : (
            visibleGroups.map(([contractName, projectGroup]) => (
              <div key={contractName}>
                <div className="flex items-center gap-0.5 mb-4">
                    <h2 className="text-xl font-semibold capitalize">{contractName}</h2>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditingChecklist(contractName)}>
                        <Pencil className="h-4 w-4 text-muted-foreground" />
                    </Button>
                     <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => toggleContractVisibility(contractName)}>
                        <EyeOff className="h-4 w-4 text-muted-foreground" />
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
                        onMarkAsComplete={handleMarkAsComplete}
                        onResetStatus={onResetStatus}
                        onScheduleForDeletion={handleScheduleForDeletion}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
      </div>

       {hiddenContractsList.length > 0 && (
          <div className="mt-8 pt-6 border-t">
              <h3 className="font-semibold text-lg mb-4">Hidden Contracts</h3>
              <div className="flex flex-wrap gap-2">
                  {hiddenContractsList.map(name => (
                      <Button key={name} size="sm" variant="secondary" onClick={() => toggleContractVisibility(name)}>
                          {name} <Eye className="ml-2 h-4 w-4" />
                      </Button>
                  ))}
              </div>
          </div>
      )}

      {editingChecklist && (
        <EvidenceChecklistManager
            contractName={editingChecklist}
            open={!!editingChecklist}
            onOpenChange={(open) => !open && setEditingChecklist(null)}
            allChecklists={evidenceChecklists}
        />
       )}
    </>
  );
}
