'use client';

import { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Project } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Building2, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';

export default function EvidencePage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (!db) {
      setLoading(false);
      return;
    }
    const q = query(collection(db, 'projects'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedProjects = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project));
      setProjects(fetchedProjects);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching projects:", error);
      setLoading(false);
    });

    return () => unsubscribe();
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
              <Skeleton key={i} className="h-28 w-full" />
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
              <h2 className="text-xl font-semibold mb-4 capitalize">{contractName}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {projectGroup.map(project => (
                  <Card key={project.id} className="border-red-500/50 bg-red-500/5 hover:shadow-md transition-shadow cursor-pointer">
                    <CardHeader className="p-4">
                      <CardTitle className="text-sm font-semibold leading-tight">{project.address}</CardTitle>
                      {project.eNumber && <CardDescription className="text-xs pt-1">E: {project.eNumber}</CardDescription>}
                    </CardHeader>
                  </Card>
                ))}
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
