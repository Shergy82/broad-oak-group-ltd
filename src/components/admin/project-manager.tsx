'use client';

import { useState, useEffect, useMemo } from 'react';
import { db, storage, functions } from '@/lib/firebase';
import { httpsCallable } from 'firebase/functions';
import { getAuth } from 'firebase/auth';
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  addDoc,
  doc,
  serverTimestamp,
  Timestamp,
  where,
} from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/shared/spinner';
import { useToast } from '@/hooks/use-toast';
import {
  Trash2,
  FolderOpen,
  Download,
  Trash,
  FileArchive,
} from 'lucide-react';
import type { Project, ProjectFile, UserProfile } from '@/types';

/* =====================================================
   MAIN COMPONENT
===================================================== */

export function ProjectManager({ userProfile }: { userProfile: UserProfile }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const { toast } = useToast();

  /* =====================================================
     LOAD PROJECTS
  ===================================================== */

  useEffect(() => {
    let q;

    if (userProfile.role === 'owner') {
      q = query(collection(db, 'projects'), orderBy('createdAt', 'desc'));
    } else if (userProfile.department) {
      q = query(
        collection(db, 'projects'),
        where('department', '==', userProfile.department),
        orderBy('createdAt', 'desc')
      );
    } else {
      setProjects([]);
      setLoading(false);
      return;
    }

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setProjects(
          snapshot.docs.map(
            (d) => ({ id: d.id, ...d.data() } as Project)
          )
        );
        setLoading(false);
      },
      () => setLoading(false)
    );

    return () => unsubscribe();
  }, [userProfile]);

  /* =====================================================
     FILTER
  ===================================================== */

  const filteredProjects = useMemo(() => {
    return projects.filter((p) =>
      [p.address, p.eNumber, p.council, p.manager]
        .join(' ')
        .toLowerCase()
        .includes(searchTerm.toLowerCase())
    );
  }, [projects, searchTerm]);

  /* =====================================================
     DELETE SINGLE PROJECT (HTTP)
  ===================================================== */

  const handleDeleteProject = async (project: Project) => {
    if (!['admin', 'owner', 'manager'].includes(userProfile.role)) {
      toast({
        variant: 'destructive',
        title: 'Permission denied',
        description: 'You do not have permission to delete projects.',
      });
      return;
    }

    try {
      const auth = getAuth();
      const user = auth.currentUser;
      if (!user) throw new Error('Not authenticated');

      const token = await user.getIdToken();

      const res = await fetch(
        'https://europe-west2-the-final-project-5e248.cloudfunctions.net/deleteProjectAndFiles',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ projectId: project.id }),
        }
      );

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text);
      }

      toast({
        title: 'Project deleted',
        description: 'Project and all files were deleted successfully.',
      });
    } catch (err: any) {
      console.error(err);
      toast({
        variant: 'destructive',
        title: 'Delete failed',
        description: err.message || 'Unable to delete project.',
      });
    }
  };

  /* =====================================================
     DELETE ALL PROJECTS (CALLABLE)
  ===================================================== */

  const handleDeleteAllProjects = async () => {
    if (!functions) return;

    setIsDeletingAll(true);

    try {
      const fn = httpsCallable(functions, 'deleteAllProjects');
      const result = await fn();
      toast({
        title: 'All projects deleted',
        description: (result.data as any).message,
      });
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Delete failed',
        description: err.message || 'Unable to delete all projects.',
      });
    } finally {
      setIsDeletingAll(false);
    }
  };

  /* =====================================================
     RENDER
  ===================================================== */

  return (
    <div className="space-y-4">
      <div className="flex gap-4 justify-between">
        <Input
          placeholder="Search projects..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="max-w-sm"
        />

        {userProfile.role === 'owner' && (
          <Button
            variant="destructive"
            disabled={isDeletingAll || projects.length === 0}
            onClick={handleDeleteAllProjects}
          >
            {isDeletingAll ? <Spinner /> : <Trash />}
            Delete All
          </Button>
        )}
      </div>

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : filteredProjects.length === 0 ? (
        <div className="text-center p-12 border rounded">
          No projects found
        </div>
      ) : (
        <div className="border rounded-lg">
          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th className="p-2 text-left">Address</th>
                <th className="p-2">Department</th>
                <th className="p-2">Manager</th>
                <th className="p-2">Created</th>
                <th className="p-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredProjects.map((project) => (
                <tr key={project.id} className="border-b">
                  <td className="p-2">{project.address}</td>
                  <td className="p-2">{project.department}</td>
                  <td className="p-2">{project.manager}</td>
                  <td className="p-2">
                    {project.createdAt
                      ? format(project.createdAt.toDate(), 'dd/MM/yyyy')
                      : 'N/A'}
                  </td>
                  <td className="p-2 text-right">
                    {['admin', 'owner', 'manager'].includes(
                      userProfile.role
                    ) && (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDeleteProject(project)}
                      >
                        <Trash2 className="mr-1 h-4 w-4" />
                        Delete
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
