"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  doc,
  updateDoc,
  deleteField,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

import { Trash, FolderOpen, RotateCw } from "lucide-react";
import { format, addDays } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import type { Project, UserProfile } from "@/types";

/* =========================
 *  Component
 * ========================= */

interface ProjectManagerProps {
  userProfile: UserProfile;
}

export function ProjectManager({ userProfile }: ProjectManagerProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const { toast } = useToast();

  /* =========================
   *  Load projects
   * ========================= */

  useEffect(() => {
    const q = query(
      collection(db, "projects"),
      orderBy("createdAt", "desc")
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        setProjects(
          snap.docs.map(
            (d) => ({ id: d.id, ...d.data() }) as Project
          )
        );
        setLoading(false);
      },
      (err) => {
        console.error("Error loading projects:", err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, []);

  /* =========================
   *  Filtering
   * ========================= */

  const filteredProjects = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return projects.filter(
      (p) =>
        p.address?.toLowerCase().includes(term) ||
        p.eNumber?.toLowerCase().includes(term) ||
        p.manager?.toLowerCase().includes(term) ||
        p.council?.toLowerCase().includes(term)
    );
  }, [projects, searchTerm]);

  /* =========================
   *  Delete ALL (Callable)
   * ========================= */

  const handleDeleteAllProjects = async () => {
    if (userProfile.role !== "owner") {
      toast({
        variant: "destructive",
        title: "Permission denied",
        description: "Only the owner can delete all projects.",
      });
      return;
    }

    setIsDeletingAll(true);

    try {
      const deleteAllProjectsFn = httpsCallable<
        void,
        { message: string }
      >(functions, "deleteAllProjects");

      const res = await deleteAllProjectsFn();

      toast({
        title: "Success",
        description: res.data.message || "All projects deleted",
      });
    } catch (err: any) {
      console.error("Delete all failed:", err);
      toast({
        variant: "destructive",
        title: "Deletion failed",
        description: err.message || "Internal error",
      });
    } finally {
      setIsDeletingAll(false);
    }
  };

  /* =========================
   *  Cancel scheduled deletion
   * ========================= */

  const cancelDeletion = async (project: Project) => {
    try {
      await updateDoc(doc(db, "projects", project.id), {
        deletionScheduledAt: deleteField(),
      });

      toast({
        title: "Cancelled",
        description: "Project deletion cancelled.",
      });
    } catch (err: any) {
      console.error("Cancel failed:", err);
      toast({
        variant: "destructive",
        title: "Error",
        description: err.message || "Failed to cancel deletion",
      });
    }
  };

  /* =========================
   *  UI
   * ========================= */

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-4 justify-between">
        <Input
          placeholder="Search projects..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="max-w-sm"
        />

        {userProfile.role === "owner" && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="destructive"
                disabled={isDeletingAll || projects.length === 0}
              >
                <Trash className="mr-2 h-4 w-4" />
                {isDeletingAll ? "Deleting…" : "Delete All"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Delete ALL projects?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete every project and
                  all associated files. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDeleteAllProjects}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Yes, delete everything
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : filteredProjects.length === 0 ? (
        <div className="border border-dashed rounded-lg p-12 text-center">
          <FolderOpen className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-4 text-muted-foreground">
            No projects found.
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {filteredProjects.map((project) => (
            <Card
              key={project.id}
              className={
                project.deletionScheduledAt
                  ? "border-destructive bg-destructive/10"
                  : ""
              }
            >
              <CardHeader>
                <CardTitle>{project.address}</CardTitle>
              </CardHeader>

              <CardContent className="text-sm space-y-1">
                <div>E-Number: {project.eNumber || "N/A"}</div>
                <div>Manager: {project.manager || "N/A"}</div>
                <div>
                  Created:{" "}
                  {project.createdAt
                    ? format(
                        project.createdAt.toDate(),
                        "dd/MM/yyyy"
                      )
                    : "N/A"}
                </div>

                {project.deletionScheduledAt && (
                  <div className="text-destructive font-medium mt-2">
                    Scheduled for deletion on{" "}
                    {format(
                      addDays(
                        project.deletionScheduledAt.toDate(),
                        7
                      ),
                      "dd/MM/yyyy"
                    )}
                  </div>
                )}
              </CardContent>

              {project.deletionScheduledAt &&
                ["admin", "owner", "manager", "TLO"].includes(
                  userProfile.role
                ) && (
                  <CardFooter>
                    <Button
                      variant="secondary"
                      onClick={() => cancelDeletion(project)}
                    >
                      <RotateCw className="mr-2 h-4 w-4" />
                      Cancel Deletion
                    </Button>
                  </CardFooter>
                )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
