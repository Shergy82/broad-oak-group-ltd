
'use client';

import { useEffect, useMemo, useState, Suspense } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Project, Shift } from '@/types';
import { useAuth } from '@/hooks/use-auth';
import { useRouter, useSearchParams } from 'next/navigation';
import { Spinner } from '@/components/shared/spinner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Building } from 'lucide-react';
import { ProjectFiles } from '@/components/projects/project-files';
import { useUserProfile } from '@/hooks/use-user-profile';
import { ProjectManager } from '@/components/admin/project-manager';

function ProjectsPageContent() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const { userProfile, loading: isProfileLoading } = useUserProfile();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialSearchTerm = searchParams.get('address') || '';

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState(initialSearchTerm);

  const isPrivilegedUser = userProfile && ['admin', 'owner', 'manager', 'TLO'].includes(userProfile.role);

  useEffect(() => {
    if (!isAuthLoading && !user) {
      router.push('/login');
    }
  }, [user, isAuthLoading, router]);

  /**
   * 🔒 UNIFIED PROJECT FETCHING
   * To ensure visibility, everyone (Operatives and Admins) now sees all projects 
   * within their assigned department. This solves the "literal address match" 
   * issue where operatives couldn't see site files if the schedule address 
   * varied by a single character.
   */
  useEffect(() => {
    if (isProfileLoading || !userProfile) return;

    const isOwner = userProfile.role === 'owner';
    const dept = userProfile.department;

    if (!isOwner && !dept) {
        setLoading(false);
        return;
    }

    setLoading(true);
    const projectsCollection = collection(db, 'projects');
    
    // 🔒 Non-owners are restricted by department
    const q = isOwner 
        ? projectsCollection 
        : query(projectsCollection, where('department', '==', dept));
        
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
        const fetchedProjects: Project[] = [];
        querySnapshot.forEach((doc) => {
            fetchedProjects.push({ id: doc.id, ...doc.data() } as Project);
        });
        
        // Sort by address numerically
        setProjects(fetchedProjects.sort((a, b) => a.address.localeCompare(b.address, undefined, { numeric: true })));
        setLoading(false);
    }, (error) => {
        console.error("Error fetching projects:", error);
        setProjects([]);
        setLoading(false);
    });

    return () => unsubscribe();
}, [userProfile, isProfileLoading]);


  const filteredProjects = useMemo(() => {
    const searchedProjects = projects.filter(project =>
      project.address.toLowerCase().includes(searchTerm.toLowerCase()) ||
      project.eNumber?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const uniqueProjects = new Map<string, Project>();
    for (const project of searchedProjects) {
        const key = `${project.address.toLowerCase()}|${(project.eNumber || '').toLowerCase()}`;
        if (!uniqueProjects.has(key)) {
            uniqueProjects.set(key, project);
        }
    }
    
    const uniqueProjectsArray = Array.from(uniqueProjects.values());
    
    uniqueProjectsArray.sort((a, b) => {
      return a.address.localeCompare(b.address, undefined, { numeric: true });
    });

    return uniqueProjectsArray;
  }, [projects, searchTerm]);
  
  const isLoadingPage = isAuthLoading || isProfileLoading || loading;
  
  if (isLoadingPage) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center">
        <Spinner size="lg" />
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
      {isPrivilegedUser && userProfile ? (
          <Card>
              <CardHeader>
              <CardTitle>Project & File Management</CardTitle>
              <CardDescription>Create new projects and upload or delete files associated with them. All users can view projects and files here.</CardDescription>
              </CardHeader>
              <CardContent>
                  <ProjectManager userProfile={userProfile} initialSearchTerm={initialSearchTerm} />
              </CardContent>
          </Card>
      ) : (
          <Card>
          <CardHeader>
              <CardTitle>Projects</CardTitle>
              <CardDescription>Search for projects in your department and manage your uploaded files.</CardDescription>
              <div className="pt-4">
              <Input
                  placeholder="Search by address or number..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="max-w-sm"
              />
              </div>
          </CardHeader>
          <CardContent>
              {loading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Card key={i}><CardHeader><div className="h-5 w-3/4 bg-muted rounded animate-pulse" /><div className="h-4 w-1/4 bg-muted rounded animate-pulse mt-2" /></CardHeader><CardContent><div className="h-24 bg-muted rounded-lg animate-pulse" /></CardContent></Card>
                  ))}
              </div>
              ) : filteredProjects.length === 0 ? (
                  <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
                      <Building className="mx-auto h-12 w-12 text-muted-foreground" />
                      <h3 className="mt-4 text-lg font-semibold">No Projects Found</h3>
                      <p className="mb-4 mt-2 text-sm text-muted-foreground">
                          No projects have been assigned to your department yet.
                      </p>
                  </div>
              ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {filteredProjects.map((project) => (
                  <Card key={project.id}>
                      <CardHeader>
                          <CardTitle className="text-lg">{project.address}</CardTitle>
                          <CardDescription className="text-xs pt-2 space-y-1">
                              <div><strong>Number:</strong> {project.eNumber || 'N/A'}</div>
                              <div><strong>Council:</strong> {project.council || 'N/A'}</div>
                              <div><strong>Manager:</strong> {project.manager || 'N/A'}</div>
                          </CardDescription>
                      </CardHeader>
                      <CardContent>
                        {userProfile && <ProjectFiles project={project} userProfile={userProfile} />}
                      </CardContent>
                  </Card>
                  ))}
              </div>
              )}
          </CardContent>
          </Card>
      )}
    </main>
  );
}

export default function ProjectsPage() {
    return (
        <Suspense fallback={<main className="flex flex-1 flex-col items-center justify-center"><Spinner size="lg" /></main>}>
            <ProjectsPageContent />
        </Suspense>
    );
}
