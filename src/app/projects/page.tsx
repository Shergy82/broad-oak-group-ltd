'use client';

import { useEffect, useMemo, useState, Suspense } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Project } from '@/types';
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
    
    const q = isOwner 
        ? projectsCollection 
        : query(projectsCollection, where('department', '==', dept));
        
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
        const fetchedProjects: Project[] = [];
        querySnapshot.forEach((doc) => {
            fetchedProjects.push({ id: doc.id, ...doc.data() } as Project);
        });
        
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
    uniqueProjectsArray.sort((a, b) => a.address.localeCompare(b.address, undefined, { numeric: true }));
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
          <Card className="w-full">
              <CardHeader>
                <CardTitle>Project & File Management</CardTitle>
                <CardDescription>Create new projects and upload or delete files associated with them.</CardDescription>
              </CardHeader>
              <CardContent>
                  <ProjectManager userProfile={userProfile} initialSearchTerm={initialSearchTerm} />
              </CardContent>
          </Card>
      ) : (
          <Card className="w-full">
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
                    <Card key={i} className="h-full flex flex-col"><CardHeader><div className="h-5 w-3/4 bg-muted rounded animate-pulse" /><div className="h-4 w-1/4 bg-muted rounded animate-pulse mt-2" /></CardHeader><CardContent className="flex-1"><div className="h-48 bg-muted rounded-lg animate-pulse" /></CardContent></Card>
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
                  <Card key={project.id} className="flex flex-col h-full shadow-sm hover:shadow-md transition-shadow">
                      <CardHeader className="flex-shrink-0">
                          <CardTitle className="text-lg leading-tight line-clamp-2 min-h-[3rem]">{project.address}</CardTitle>
                          <CardDescription className="text-xs pt-2 space-y-1">
                              <div className="flex justify-between"><strong>Number:</strong> <span>{project.eNumber || 'N/A'}</span></div>
                              <div className="flex justify-between"><strong>Council:</strong> <span className="truncate ml-4">{project.council || 'N/A'}</span></div>
                              <div className="flex justify-between"><strong>Manager:</strong> <span className="truncate ml-4">{project.manager || 'N/A'}</span></div>
                          </CardDescription>
                      </CardHeader>
                      <CardContent className="flex-1 overflow-hidden">
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