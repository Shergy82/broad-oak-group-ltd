
'use client';

import { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, query, orderBy, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Project, EvidenceChecklist, ProjectFile } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Building2, Search, Pencil, CheckCircle, XCircle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { EvidenceChecklistManager } from '@/components/admin/evidence-checklist-manager';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface ProjectWithEvidence extends Project {
  evidenceStatus: {
    text: string;
    isComplete: boolean;
  }[];
  isComplete: boolean;
}

export default function EvidencePage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [evidenceChecklists, setEvidenceChecklists] = useState<Map<string, EvidenceChecklist>>(new Map());
  const [projectFiles, setProjectFiles] = useState<Map<string, ProjectFile[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingChecklist, setEditingChecklist] = useState<string | null>(null);

  useEffect(() => {
    if (!db) {
      setLoading(false);
      return;
    }
    const projectsQuery = query(collection(db, 'projects'), orderBy('createdAt', 'desc'));
    const checklistsQuery = query(collection(db, 'evidence_checklists'));

    let projectsLoaded = false;
    let checklistsLoaded = false;
    const checkLoading = () => {
        if (projectsLoaded && checklistsLoaded) setLoading(false);
    }

    const unsubProjects = onSnapshot(projectsQuery, (snapshot) => {
      const fetchedProjects = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project));
      setProjects(fetchedProjects);
      projectsLoaded = true;
      checkLoading();
    }, (error) => {
      console.error("Error fetching projects:", error);
      projectsLoaded = true;
      checkLoading();
    });

    const unsubChecklists = onSnapshot(checklistsQuery, (snapshot) => {
        const checklistsMap = new Map<string, EvidenceChecklist>();
        snapshot.docs.forEach(doc => {
            checklistsMap.set(doc.id, doc.data() as EvidenceChecklist);
        });
        setEvidenceChecklists(checklistsMap);
        checklistsLoaded = true;
        checkLoading();
    });
    
    // Unsubscribe from file listeners when component unmounts is complex with dynamic listeners.
    // Given the page context, re-subscribing on project changes is acceptable.
    const fileUnsubscribers: (() => void)[] = [];
    projects.forEach(project => {
      const filesQuery = query(collection(db, `projects/${project.id}/files`));
      const unsub = onSnapshot(filesQuery, (fileSnapshot) => {
        const files = fileSnapshot.docs.map(d => d.data() as ProjectFile);
        setProjectFiles(prev => new Map(prev).set(project.id, files));
      });
      fileUnsubscribers.push(unsub);
    });

    return () => {
        unsubProjects();
        unsubChecklists();
        fileUnsubscribers.forEach(unsub => unsub());
    };
  }, [projects]);


  const projectsWithEvidence: ProjectWithEvidence[] = useMemo(() => {
    return projects.map(project => {
        const checklist = evidenceChecklists.get(project.contract || '');
        const files = projectFiles.get(project.id) || [];
        
        if (!checklist || !checklist.items) {
            return { ...project, evidenceStatus: [], isComplete: true };
        }

        const evidenceStatus = checklist.items.map(item => {
            const isComplete = files.some(file => file.evidenceTag?.trim().toLowerCase() === item.text?.trim().toLowerCase());
            return { text: item.text, isComplete };
        });

        const isComplete = evidenceStatus.every(s => s.isComplete);
        return { ...project, evidenceStatus, isComplete };
    })
  }, [projects, evidenceChecklists, projectFiles]);


  const filteredProjects = useMemo(() => {
    if (!searchTerm) return projectsWithEvidence;
    return projectsWithEvidence.filter(project =>
      project.address.toLowerCase().includes(searchTerm.toLowerCase()) ||
      project.contract?.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [projectsWithEvidence, searchTerm]);

  const groupedProjects = useMemo(() => {
    const groups: { [key: string]: ProjectWithEvidence[] } = {};
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
                    <Card key={project.id} className={cn("hover:shadow-md transition-shadow", project.isComplete ? 'border-green-500/50 bg-green-500/5' : 'border-red-500/50 bg-red-500/5')}>
                      <CardHeader className="p-4 pb-2">
                        <CardTitle className="text-sm font-semibold leading-tight">{project.address}</CardTitle>
                        {project.eNumber && <CardDescription className="text-xs pt-1">E: {project.eNumber}</CardDescription>}
                      </CardHeader>
                      <CardContent className="p-4 pt-2">
                        {project.evidenceStatus.length > 0 ? (
                          <div className="space-y-1">
                            {project.evidenceStatus.map(item => (
                                <div key={item.text} className={cn("flex items-center gap-2 text-xs", item.isComplete ? "text-muted-foreground" : "font-semibold text-red-600")}>
                                    {item.isComplete ? <CheckCircle className="h-3 w-3 text-green-500"/> : <XCircle className="h-3 w-3 text-red-500"/>}
                                    <span>{item.text}</span>
                                </div>
                            ))}
                          </div>
                        ) : <p className="text-xs text-muted-foreground italic">No evidence checklist for this contract.</p>}
                      </CardContent>
                    </Card>
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
