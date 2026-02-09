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
  const [allFiles, setAllFiles] = useState<Map<string, ProjectFile>>(new Map());
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingChecklist, setEditingChecklist] = useState<string | null>(null);

  // Effect 1: Listen to primary data sources (projects and checklists).
  useEffect(() => {
    setLoading(true);
    const projectsQuery = query(collection(db, 'projects'), orderBy('createdAt', 'desc'));
    const unsubProjects = onSnapshot(projectsQuery, 
      (snapshot) => setProjects(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project))),
      (err) => console.error("Error fetching projects:", err)
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

  // Effect 2: Listen to all file subcollections based on the current projects.
  // This provides real-time updates for newly uploaded evidence.
  useEffect(() => {
    if (projects.length === 0) {
        setLoading(false); // Stop loading if there are no projects to listen to.
        return;
    }

    const allUnsubscribers: (() => void)[] = [];
    
    projects.forEach(project => {
      const filesQuery = query(collection(db, `projects/${project.id}/files`));
      const unsubscribe = onSnapshot(filesQuery, (filesSnapshot) => {
        setAllFiles(prevFiles => {
          const newFiles = new Map(prevFiles);
          filesSnapshot.docChanges().forEach((change) => {
            const fileData = { id: change.doc.id, ...change.doc.data() } as ProjectFile;
            if (change.type === "removed") {
              newFiles.delete(change.doc.id);
            } else {
              newFiles.set(change.doc.id, fileData);
            }
          });
          return newFiles;
        });
      });
      allUnsubscribers.push(unsubscribe);
    });

    setLoading(false); // We have set up listeners, so we can show the UI.

    return () => {
      allUnsubscribers.forEach(unsub => unsub());
    };
  }, [projects]);


  const projectsWithEvidence: ProjectWithEvidence[] = useMemo(() => {
    const getNormalizedWords = (text: string | undefined): Set<string> => {
        if (!text) return new Set();
        return new Set(
            text
                .toLowerCase()
                .split(/[\s-_]+/) 
                .map(word => word.replace(/[^a-z0-9]/g, ''))
                .map(word => word.endsWith('s') ? word.slice(0, -1) : word)
                .filter(Boolean)
        );
    };

    const isMatch = (checklistText: string, fileTag: string | undefined): boolean => {
        const checklistWords = getNormalizedWords(checklistText);
        const tagWords = getNormalizedWords(fileTag);

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

    const projectFilesMap = new Map<string, ProjectFile[]>();
    Array.from(allFiles.values()).forEach(file => {
      const pathParts = file.fullPath?.split('/');
      if (pathParts && pathParts.length >= 3 && pathParts[0] === 'project_files') {
        const projectId = pathParts[1];
        if (!projectFilesMap.has(projectId)) {
          projectFilesMap.set(projectId, []);
        }
        projectFilesMap.get(projectId)!.push(file);
      }
    });

    return projects.map(project => {
        const checklist = evidenceChecklists.get(project.contract || '');
        const files = projectFilesMap.get(project.id) || [];
        
        if (!checklist || !checklist.items || checklist.items.length === 0) {
            return { ...project, evidenceStatus: [], isComplete: true };
        }

        const evidenceStatus = checklist.items.map(item => {
            const isComplete = files.some(file => isMatch(item.text, file.evidenceTag));
            return { text: item.text, isComplete };
        });

        const isComplete = evidenceStatus.every(s => s.isComplete);
        return { ...project, evidenceStatus, isComplete };
    })
  }, [projects, evidenceChecklists, allFiles]);


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
