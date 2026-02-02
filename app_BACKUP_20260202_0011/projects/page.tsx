
'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Project } from '@/types';
import { useAuth } from '@/hooks/use-auth';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/layout/header';
import { Spinner } from '@/components/shared/spinner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Building } from 'lucide-react';
import { ProjectFiles } from '@/components/projects/project-files';
import { useUserProfile } from '@/hooks/use-user-profile';
import { ProjectManager } from '@/components/admin/project-manager';

export default function ProjectsPage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const { userProfile, loading: isProfileLoading } = useUserProfile();
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  const isPrivilegedUser = userProfile && ['admin', 'owner', 'manager'].includes(userProfile.role);

  useEffect(() => {
    if (!isAuthLoading && !user) {
      router.push('/login');
    }
  }, [user, isAuthLoading, router]);

  useEffect(() => {
    // The admin ProjectManager component fetches its own data.
    // This effect should only run for regular users if they don't have a privileged role.
    if (isPrivilegedUser) {
      setLoading(false);
      return;
    }

    if (!db) {
      setProjects([]);
      setLoading(false);
      return;
    }
    if (!user) return;

    const projectsCollection = collection(db, 'projects');
    const q = query(projectsCollection);

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const fetchedProjects: Project[] = [];
      querySnapshot.forEach((doc) => {
        fetchedProjects.push({ id: doc.id, ...doc.data() } as Project);
      });
      setProjects(fetchedProjects.sort((a, b) => a.address.localeCompare(b.address)));
      setLoading(false);
    }, (error) => {
      console.error("Error fetching projects: ", error);
      setProjects([]);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user, isPrivilegedUser]);

  const filteredProjects = useMemo(() => {
    return projects.filter(project =>
      project.address.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [projects, searchTerm]);
  
  const isLoadingPage = isAuthLoading || isProfileLoading;
  
  if (isLoadingPage) {
    return (
      <div className="flex min-h-screen w-full flex-col items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full flex-col">
      <Header />
      <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
        {isPrivilegedUser && userProfile ? (
            <Card>
                <CardHeader>
                <CardTitle>Project & File Management</CardTitle>
                <CardDescription>Create new projects and upload or delete files associated with them. All users can view projects and files here.</CardDescription>
                </CardHeader>
                <CardContent>
                    <ProjectManager userProfile={userProfile} />
                </CardContent>
            </Card>
        ) : (
            <Card>
            <CardHeader>
                <CardTitle>Projects</CardTitle>
                <CardDescription>Search for projects and manage your uploaded files.</CardDescription>
                <div className="pt-4">
                <Input
                    placeholder="Search by address..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="max-w-sm"
                />
                </div>
            </CardHeader>
            <CardContent>
                {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    <Card><CardHeader><div className="h-5 w-3/4 bg-muted rounded animate-pulse" /><div className="h-4 w-1/4 bg-muted rounded animate-pulse mt-2" /></CardHeader><CardContent><div className="h-24 bg-muted rounded-lg animate-pulse" /></CardContent></Card>
                    <Card><CardHeader><div className="h-5 w-3/4 bg-muted rounded animate-pulse" /><div className="h-4 w-1/4 bg-muted rounded animate-pulse mt-2" /></CardHeader><CardContent><div className="h-24 bg-muted rounded-lg animate-pulse" /></CardContent></Card>
                    <Card><CardHeader><div className="h-5 w-3/4 bg-muted rounded animate-pulse" /><div className="h-4 w-1/4 bg-muted rounded animate-pulse mt-2" /></CardHeader><CardContent><div className="h-24 bg-muted rounded-lg animate-pulse" /></CardContent></Card>
                </div>
                ) : filteredProjects.length === 0 ? (
                    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
                        <Building className="mx-auto h-12 w-12 text-muted-foreground" />
                        <h3 className="mt-4 text-lg font-semibold">No Projects Found</h3>
                        <p className="mb-4 mt-2 text-sm text-muted-foreground">
                            No projects have been added yet. This page will populate once project data exists in the database.
                        </p>
                    </div>
                ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filteredProjects.map((project) => (
                    <Card key={project.id}>
                        <CardHeader>
                            <CardTitle className="text-lg">{project.address}</CardTitle>
                            <CardDescription className="text-xs pt-2 space-y-1">
                                <div><strong>E-Number:</strong> {project.eNumber || 'N/A'}</div>
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
    </div>
  );
}
