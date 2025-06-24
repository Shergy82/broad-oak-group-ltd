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
import { mockProjects } from '@/lib/mock-data';
import { Building, FileText } from 'lucide-react';

export default function ProjectsPage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (!isAuthLoading && !user) {
      router.push('/login');
    }
  }, [user, isAuthLoading, router]);

  useEffect(() => {
    if (!db) {
      setProjects(mockProjects);
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
      setProjects(mockProjects);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  const filteredProjects = useMemo(() => {
    return projects.filter(project =>
      project.address.toLowerCase().includes(searchTerm.toLowerCase()) ||
      project.bNumber?.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [projects, searchTerm]);
  
  if (isAuthLoading || !user) {
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
        <Card>
          <CardHeader>
            <CardTitle>Projects</CardTitle>
            <CardDescription>Search for projects by address or B Number to view details and attached files.</CardDescription>
            <div className="pt-4">
              <Input
                placeholder="Search by address or B Number..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="max-w-sm"
              />
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
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
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {filteredProjects.map((project) => (
                  <Card key={project.id}>
                    <CardHeader>
                      <CardTitle className="text-lg">{project.address}</CardTitle>
                      {project.bNumber && <CardDescription>B Number: {project.bNumber}</CardDescription>}
                    </CardHeader>
                    <CardContent>
                      <h4 className="text-sm font-semibold mb-2">Attached Files</h4>
                      <div className="text-center text-muted-foreground p-4 border-dashed border rounded-lg">
                          <FileText className="mx-auto h-8 w-8 text-muted-foreground/50" />
                          <p className="mt-2 text-sm">File attachments are coming soon.</p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
