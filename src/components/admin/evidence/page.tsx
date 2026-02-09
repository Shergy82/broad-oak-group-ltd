'use client';

import { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, query, orderBy, doc } from 'firebase/firestore';
import { db, functions, httpsCallable } from '@/lib/firebase';
import type { Project, EvidenceChecklist, ProjectFile, UserProfile } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Building2, Search, Pencil, CheckCircle, XCircle, Download, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { EvidenceChecklistManager } from '@/components/admin/evidence-checklist-manager';
import { cn } from '@/lib/utils';
import { Spinner } from '@/components/shared/spinner';
import { useUserProfile } from '@/hooks/use-user-profile';
import { useToast } from '@/hooks/use-toast';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { format } from 'date-fns';

const isMatch = (checklistText: string, fileTag: string | undefined): boolean => {
    if (!fileTag || !checklistText) return false;

    const normalize = (text: string): Set<string> => 
        new Set(
            text
                .toLowerCase()
                .split(/[\s-_]+/)
                .map(word => word.replace(/[^a-z0-9]/g, ''))
                .map(word => word.endsWith('s') ? word.slice(0, -1) : word)
                .filter(Boolean)
        );

    const checklistWords = normalize(checklistText);
    const tagWords = normalize(fileTag);

    if (tagWords.size === 0 || checklistWords.size === 0) {
        return false;
    }
    
    for (const tagWord of tagWords) {
        if (!checklistWords.has(tagWord)) {
            return false;
        }
    }
    
    return true;
};

interface EvidenceReportGeneratorProps {
  project: Project;
  files: ProjectFile[];
  onGenerated: () => void;
}

function EvidenceReportGenerator({ project, files, onGenerated }: EvidenceReportGeneratorProps) {
  const [isGenerating, setIsGenerating] = useState(false);

  const generatePdf = async () => {
    setIsGenerating(true);

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.width;
    const pageMargin = 14;
    
    const logoSvg = `<svg width="28" height="28" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><g transform="translate(16,16)"><path d="M 0 -14 A 14 14 0 0 1 14 0 L 8 0 A 8 8 0 0 0 0 -8 Z" fill="#84cc16" transform="rotate(0)"/><path d="M 0 -14 A 14 14 0 0 1 14 0 L 8 0 A 8 8 0 0 0 0 -8 Z" fill="#22d3ee" transform="rotate(90)"/><path d="M 0 -14 A 14 14 0 0 1 14 0 L 8 0 A 8 8 0 0 0 0 -8 Z" fill="#f87171" transform="rotate(180)"/><path d="M 0 -14 A 14 14 0 0 1 14 0 L 8 0 A 8 8 0 0 0 0 -8 Z" fill="#fbbf24" transform="rotate(270)"/></g></svg>`;
    const logoDataUrl = `data:image/svg+xml;base64,${btoa(logoSvg)}`;
    
    const pngDataUrl: string = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 28;
        canvas.height = 28;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, 28, 28);
          resolve(canvas.toDataURL('image/png'));
        } else {
          reject(new Error('Failed to get canvas context'));
        }
      };
      img.onerror = () => reject(new Error('Failed to load SVG for conversion'));
      img.src = logoDataUrl;
    });
    
    doc.setFillColor(248, 250, 252);
    doc.rect(0, 0, pageWidth, 28, 'F');
    doc.addImage(pngDataUrl, 'PNG', pageMargin, 10, 8, 8);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(15, 23, 42);
    doc.text('BROAD OAK GROUP', pageMargin + 12, 16);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    doc.text('Live', pageMargin + 12, 21);
    
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.text('Evidence Report', pageMargin, 45);

    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.text(project.address, pageMargin, 55);
    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    doc.text(`E-Number: ${project.eNumber || 'N/A'} | Generated: ${format(new Date(), 'PPP')}`, pageMargin, 60);

    let finalY = 70;
    const photos = files.filter(f => f.type?.startsWith('image/'));

    for (const photo of photos) {
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

        if (finalY + imgHeight + 20 > doc.internal.pageSize.height) {
          doc.addPage();
          finalY = pageMargin;
        }

        doc.addImage(dataUrl, 'JPEG', pageMargin, finalY, imgWidth, imgHeight);
        finalY += imgHeight + 5;

        const captionText = `${photo.evidenceTag ? `Tag: ${photo.evidenceTag}` : photo.name} - Uploaded by ${photo.uploaderName}`;
        doc.setFontSize(9);
        doc.setTextColor(100, 116, 139);
        doc.text(captionText, pageMargin, finalY);
        finalY += 10;
      } catch (e) {
        console.error("Could not add image to PDF", e);
        if (finalY + 10 > doc.internal.pageSize.height) {
            doc.addPage();
            finalY = pageMargin;
        }
        doc.setFontSize(9);
        doc.setTextColor(255, 0, 0);
        doc.text(`Failed to load image: ${photo.name}`, pageMargin, finalY);
        finalY += 10;
      }
    }

    doc.save(`evidence_${project.address.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`);
    setIsGenerating(false);
    onGenerated();
  };

  return (
    <Button onClick={generatePdf} disabled={isGenerating} size="sm" className="w-full">
      {isGenerating ? <Spinner /> : <><Download className="mr-2 h-4 w-4" /> Generate Evidence PDF</>}
    </Button>
  );
}


function ProjectEvidenceCard({ project, checklist }: { project: Project; checklist: EvidenceChecklist | undefined }) {
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [evidenceState, setEvidenceState] = useState<'incomplete' | 'ready' | 'generated'>('incomplete');
  const [isClient, setIsClient] = useState(false);

  const { userProfile } = useUserProfile();
  const { toast } = useToast();
  
  const LOCAL_STORAGE_KEY = 'evidence_pdf_generated_projects_v3';

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    setLoadingFiles(true);
    const filesQuery = query(collection(db, `projects/${project.id}/files`));
    const unsubscribe = onSnapshot(filesQuery, (snapshot) => {
      const fetchedFiles = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ProjectFile));
      setFiles(fetchedFiles);
      setLoadingFiles(false);
    }, (error) => {
      console.error(`Error fetching files for project ${project.id}:`, error);
      setLoadingFiles(false);
    });

    return () => unsubscribe();
  }, [project.id]);

  useEffect(() => {
    if (!isClient || loadingFiles) return;

    const isChecklistMet = (() => {
        if (!checklist || !checklist.items || checklist.items.length === 0) {
            return true;
        }
        return checklist.items.every(item => 
            files.some(file => isMatch(item.text, file.evidenceTag))
        );
    })();

    const generatedPdfs = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]');
    const isPdfGenerated = generatedPdfs.includes(project.id);
    
    if (!isChecklistMet) {
      setEvidenceState('incomplete');
    } else {
      if (isPdfGenerated) {
        setEvidenceState('generated');
      } else {
        setEvidenceState('ready');
      }
    }
  }, [files, checklist, isClient, project.id, loadingFiles]);

  const onPdfGenerated = () => {
    try {
      const generatedPdfs = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]');
      if (!generatedPdfs.includes(project.id)) {
        generatedPdfs.push(project.id);
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(generatedPdfs));
      }
      setEvidenceState('generated');
    } catch (e) {
      console.error("Failed to write to local storage", e);
    }
  }

  const handleDeleteProject = async () => {
    if (!userProfile || !['admin', 'owner', 'manager', 'TLO'].includes(userProfile.role)) {
        toast({ variant: 'destructive', title: 'Permission Denied', description: 'You do not have permission to delete projects.' });
        return;
    }
     if (!functions) {
        toast({ variant: 'destructive', title: 'Error', description: 'Firebase Functions service is not available.' });
        return;
    }

    toast({ title: 'Deleting Project...', description: 'This may take a moment.' });
    try {
        const deleteProjectAndFilesFn = httpsCallable<{projectId: string}>(functions, 'deleteProjectAndFiles');
        await deleteProjectAndFilesFn({ projectId: project.id });
        
        toast({ title: 'Success', description: 'Project and all its files have been deleted.' });
    } catch (error: any) {
        console.error("Error calling deleteProjectAndFiles function:", error);
        toast({ 
            variant: 'destructive', 
            title: 'Deletion Failed', 
            description: error.message || 'An unknown error occurred. Please check the function logs in the Firebase Console.' 
        });
    }
  };

  const { evidenceStatus } = useMemo(() => {
    if (!checklist || !checklist.items || checklist.items.length === 0) {
      return { evidenceStatus: [] };
    }
    const status = checklist.items.map(item => {
      const itemIsComplete = files.some(file => isMatch(item.text, file.evidenceTag));
      return { text: item.text, isComplete: itemIsComplete };
    });
    return { evidenceStatus: status };
  }, [files, checklist]);

  const cardColorClass = {
    incomplete: 'bg-red-400 border-red-700',
    ready: 'bg-orange-400 border-orange-700',
    generated: 'bg-green-400 border-green-700',
  }[evidenceState];

  const textColorClass = {
    incomplete: 'text-red-950',
    ready: 'text-orange-950',
    generated: 'text-green-950',
  }[evidenceState];

  return (
    <Card className={cn("hover:shadow-md transition-shadow flex flex-col", cardColorClass)}>
      <CardHeader className="p-4 pb-2">
        <CardTitle className={cn("text-sm font-semibold leading-tight", textColorClass)}>{project.address}</CardTitle>
        {project.eNumber && <CardDescription className={cn("text-xs pt-1 opacity-80", textColorClass)}>E: {project.eNumber}</CardDescription>}
      </CardHeader>
      <CardContent className="p-4 pt-2 flex-grow">
        {loadingFiles ? (
          <div className="flex justify-center items-center h-16">
            <Spinner size="sm" />
          </div>
        ) : evidenceStatus.length > 0 ? (
          <div className="space-y-1">
            {evidenceStatus.map(item => (
                <div key={item.text} className={cn("flex items-center gap-2 text-xs", item.isComplete ? cn(textColorClass, "opacity-70") : cn("font-semibold", textColorClass))}>
                    {item.isComplete ? <CheckCircle className="h-3 w-3 opacity-90"/> : <XCircle className="h-3 w-3"/>}
                    <span>{item.text}</span>
                </div>
            ))}
          </div>
        ) : <p className="text-xs italic">No evidence checklist for this contract.</p>}
      </CardContent>
      <CardFooter className="p-2 border-t mt-auto">
        {evidenceState === 'ready' && (
          <EvidenceReportGenerator project={project} files={files} onGenerated={onPdfGenerated} />
        )}
        {evidenceState === 'generated' && (
           <AlertDialog>
              <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm" className="w-full">
                      <Trash2 className="mr-2 h-4 w-4" /> Delete Project
                  </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                    <AlertDialogDescription>This will permanently delete the project and all its files. This action cannot be undone.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDeleteProject} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete Project</AlertDialogAction>
                  </AlertDialogFooter>
              </AlertDialogContent>
          </AlertDialog>
        )}
      </CardFooter>
    </Card>
  );
}


export default function EvidencePage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [evidenceChecklists, setEvidenceChecklists] = useState<Map<string, EvidenceChecklist>>(new Map());
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingChecklist, setEditingChecklist] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    const projectsQuery = query(collection(db, 'projects'), orderBy('createdAt', 'desc'));
    const unsubProjects = onSnapshot(projectsQuery, 
      (snapshot) => {
          setProjects(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)));
          setLoading(false);
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

  const filteredProjects = useMemo(() => {
    if (!searchTerm) return projects;
    return projects.filter(project =>
      project.address.toLowerCase().includes(searchTerm.toLowerCase()) ||
      project.contract?.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [projects, searchTerm]);

  const groupedProjects = useMemo(() => {
    const groups: { [key: string]: Project[] } = {};
    filteredProjects.forEach(project => {
      const groupName = project.contract || 'Uncategorized';
      if (!groups[groupName]) {
        groups[groupName] = [];
      }
      groups[groupName].push(project);
    });
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredProjects]);


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
              <h3 className="mt-4 text-lg font-semibold">No Projects Found</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Projects will appear here once they are created, for example, via the shift import process.
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
