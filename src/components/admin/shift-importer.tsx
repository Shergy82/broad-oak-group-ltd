'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FileUploader } from './file-uploader';
import type { UserProfile, Shift } from '@/types';
import { Button } from '@/components/ui/button';
import { functions, httpsCallable } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { Spinner } from '@/components/shared/spinner';
import { Badge } from '@/components/ui/badge';

interface DryRunResult {
  toCreate: any[];
  toUpdate: { id: string; old: Shift; new: any; changes: { field: string; old: string; new: string }[] }[];
  toDelete: Shift[];
  toSynced: Shift[];
  toIssues: any[];
  profileId: string;
  profileName: string;
}

interface ShiftImporterProps {
  userProfile: UserProfile;
}

const fieldLabels: Record<string, string> = {
  descriptionOfWorks: "Description of works",
  address: "Address",
  contract: "Contract",
  eNumber: "E Number",
  manager: "Manager",
  date: "Date",
  startTime: "Start time",
  endTime: "End time",
  room: "Room",
  type: "Shift type",
};

const HIDDEN_UPDATE_FIELDS = [
  "userId",
  "userName",
  "operativeUid",
  "operative",
  "source",
  "sourcePlannerId",
  "sourcePlannerName",
  "plannerName",
  "profileId",
  "importKey",
  "sourceSheet",
  "sourceCell",
  "dateKey",
  "createdAt",
  "updatedAt",
  "status"
];

function cleanDescriptionForDisplay(value: string, operativeName?: string): string {
  if (!value) return "";

  let cleaned = String(value).trim().replace(/\s+/g, " ");

  const operative = String(operativeName || "").trim().replace(/\s+/g, " ");

  if (operative) {
    const suffix = ` - ${operative}`;
    if (cleaned.toLowerCase().endsWith(suffix.toLowerCase())) {
      cleaned = cleaned.slice(0, -suffix.length).trim();
    }
  }

  return cleaned;
}

function renderValueDiff(field: string, oldVal: string, newVal: string, oldOp?: string, newOp?: string) {
  const snippet = (val: string, max = 120) => {
    if (!val || val === "(blank)") return "blank";
    return val.length > max ? val.slice(0, max) + "..." : val;
  };
  
  let displayOld = oldVal;
  let displayNew = newVal;

  if (field === 'descriptionOfWorks') {
    displayOld = cleanDescriptionForDisplay(oldVal, oldOp);
    displayNew = cleanDescriptionForDisplay(newVal, newOp);
  }

  const label = fieldLabels[field] || field;

  return (
    <div className="flex flex-col gap-1 py-2 border-b last:border-b-0 border-muted-foreground/10">
      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-tight">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="line-through text-red-600 opacity-70 whitespace-pre-wrap decoration-1">
          {snippet(displayOld)}
        </span>
        <span className="text-muted-foreground text-xs">→</span>
        <span className="rounded bg-green-50 px-2 py-0.5 font-medium text-green-700 whitespace-pre-wrap">
          {snippet(displayNew)}
        </span>
      </div>
    </div>
  );
}

export function ShiftImporter({ userProfile }: ShiftImporterProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [activeTab, setActiveTab] = useState<string>('create');

  useEffect(() => {
    if (dryRun) {
      if (dryRun.toIssues.length > 0) {
        setActiveTab('issues');
      } else if (dryRun.toCreate.length > 0) {
        setActiveTab('create');
      } else if (dryRun.toUpdate.length > 0) {
        setActiveTab('update');
      } else {
        setActiveTab('synced');
      }
    }
  }, [dryRun]);

  const handleImportComplete = (result: DryRunResult) => {
    setDryRun(result);
  };

  const handleFinalPublish = async () => {
    if (!dryRun || !user) return;
    setIsPublishing(true);

    try {
      if (!functions) throw new Error('Functions not available');
      const reconcileShifts = httpsCallable(functions, 'reconcileShifts');

      await reconcileShifts({
        toCreate: dryRun.toCreate,
        toUpdate: dryRun.toUpdate.map(u => ({ id: u.id, new: u.new })),
        toDelete: dryRun.toDelete.map(s => ({ id: s.id })),
        department: userProfile.department || 'Gas',
        profileId: dryRun.profileId,
        profileName: dryRun.profileName
      });

      toast({ title: 'Success', description: 'Schedule synchronized successfully.' });
      setDryRun(null);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Sync Failed', description: err?.message || 'Check connection' });
    } finally {
      setIsPublishing(false);
    }
  };

  if (dryRun) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <Card 
            role="button"
            tabIndex={0}
            onClick={() => setActiveTab('create')}
            className={cn(
              "cursor-pointer transition-all hover:shadow-md hover:scale-[1.01] bg-green-50 border-green-200",
              activeTab === 'create' && "ring-2 ring-green-500 shadow-md"
            )}
          >
            <CardHeader className="p-3">
              <CardTitle className="text-[10px] text-green-700 uppercase">New</CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <p className="text-2xl font-bold text-green-700">{dryRun.toCreate.length}</p>
            </CardContent>
          </Card>

          <Card 
            role="button"
            tabIndex={0}
            onClick={() => setActiveTab('update')}
            className={cn(
              "cursor-pointer transition-all hover:shadow-md hover:scale-[1.01] bg-blue-50 border-blue-200",
              activeTab === 'update' && "ring-2 ring-blue-500 shadow-md"
            )}
          >
            <CardHeader className="p-3">
              <CardTitle className="text-[10px] text-blue-700 uppercase">Updates</CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <p className="text-2xl font-bold text-blue-700">{dryRun.toUpdate.length}</p>
            </CardContent>
          </Card>

          <Card 
            role="button"
            tabIndex={0}
            onClick={() => setActiveTab('delete')}
            className={cn(
              "cursor-pointer transition-all hover:shadow-md hover:scale-[1.01] bg-amber-50 border-amber-200",
              activeTab === 'delete' && "ring-2 ring-amber-500 shadow-md"
            )}
          >
            <CardHeader className="p-3">
              <CardTitle className="text-[10px] text-amber-700 uppercase">Remove</CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <p className="text-2xl font-bold text-amber-700">{dryRun.toDelete.length}</p>
            </CardContent>
          </Card>

          <Card 
            role="button"
            tabIndex={0}
            onClick={() => setActiveTab('synced')}
            className={cn(
              "cursor-pointer transition-all hover:shadow-md hover:scale-[1.01] bg-slate-50 border-slate-200",
              activeTab === 'synced' && "ring-2 ring-slate-400 shadow-md"
            )}
          >
            <CardHeader className="p-3">
              <CardTitle className="text-[10px] text-slate-700 uppercase">Synced</CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <p className="text-2xl font-bold text-slate-700">{dryRun.toSynced.length}</p>
            </CardContent>
          </Card>

          <Card 
            role="button"
            tabIndex={0}
            onClick={() => setActiveTab('issues')}
            className={cn(
              "cursor-pointer transition-all hover:shadow-md hover:scale-[1.01] bg-red-50 border-red-200",
              activeTab === 'issues' && "ring-2 ring-red-500 shadow-md"
            )}
          >
            <CardHeader className="p-3">
              <CardTitle className="text-[10px] text-red-700 uppercase">Issues</CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <p className="text-2xl font-bold text-red-700">{dryRun.toIssues.length}</p>
            </CardContent>
          </Card>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-5 h-auto">
            <TabsTrigger value="create" className="text-[11px]">New</TabsTrigger>
            <TabsTrigger value="update" className="text-[11px]">Updates</TabsTrigger>
            <TabsTrigger value="delete" className="text-[11px]">Remove</TabsTrigger>
            <TabsTrigger value="synced" className="text-[11px]">Synced</TabsTrigger>
            <TabsTrigger value="issues" className={cn('text-[11px]', dryRun.toIssues.length > 0 && 'text-destructive font-bold')}>Issues</TabsTrigger>
          </TabsList>

          <TabsContent value="update" className="mt-4">
            <ScrollArea className="h-[450px] border rounded-md">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow><TableHead>Shift</TableHead><TableHead>Changes Found</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {dryRun.toUpdate.map((u, i) => {
                    // Filter technical fields and redundant task names
                    let visibleChanges = u.changes.filter(c => !HIDDEN_UPDATE_FIELDS.includes(c.field));
                    const hasDescChange = visibleChanges.some(c => c.field === 'descriptionOfWorks');
                    if (hasDescChange) {
                      visibleChanges = visibleChanges.filter(c => c.field !== 'task');
                    }

                    if (visibleChanges.length === 0) return null;

                    return (
                      <TableRow key={i}>
                        <TableCell className="text-[10px] leading-tight w-[250px]">
                          <div className="flex flex-col gap-1">
                              <span className="font-bold text-sm">{u.new.operative}</span>
                              <span className="opacity-70">{u.new.dateKey}</span>
                              <span className="italic">{u.new.address}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            {visibleChanges.map((c, idx) => (
                                <div key={idx}>
                                    {renderValueDiff(
                                      c.field, 
                                      c.old, 
                                      c.new, 
                                      u.old.operative || u.old.userName, 
                                      u.new.operative
                                    )}
                                </div>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  }).filter(Boolean)}
                  {dryRun.toUpdate.length === 0 && <TableRow><TableCell colSpan={2} className="text-center py-12 text-muted-foreground">No updates needed.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="issues" className="mt-4">
            <ScrollArea className="h-[450px] border rounded-md">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead className="w-20">Cell</TableHead>
                    <TableHead>Operative</TableHead>
                    <TableHead className="w-24">Date</TableHead>
                    <TableHead>Address / Task</TableHead>
                    <TableHead className="text-right">Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dryRun.toIssues.map((err, i) => (
                    <TableRow key={i} className="bg-red-50/50 hover:bg-red-50 transition-colors">
                      <TableCell className="text-[10px] font-bold text-red-800">{err.cell || '—'}</TableCell>
                      <TableCell className="text-xs font-semibold">{err.operative || '—'}</TableCell>
                      <TableCell className="text-[10px]">{err.date || '—'}</TableCell>
                      <TableCell className="text-[10px] leading-tight py-2">
                        <div className="flex flex-col gap-1">
                            <span className="truncate max-w-[260px] font-bold text-slate-800">{err.address || '—'}</span>
                            <span className="italic opacity-70 break-words">{err.task || '—'}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="inline-block rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-medium text-red-700 leading-snug max-w-[240px] text-left break-words">
                          {err.message}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {dryRun.toIssues.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-12 text-muted-foreground">No import issues found.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="create" className="mt-4">
            <ScrollArea className="h-[400px] border rounded-md">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow><TableHead>Date</TableHead><TableHead>User</TableHead><TableHead>Address</TableHead><TableHead>Task</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {dryRun.toCreate.map((s, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs whitespace-nowrap">{s.dateKey}</TableCell>
                      <TableCell className="text-xs font-bold">{s.operative}</TableCell>
                      <TableCell className="text-xs">{s.address}</TableCell>
                      <TableCell className="text-xs italic text-muted-foreground">{s.task}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="synced" className="mt-4">
             <ScrollArea className="h-[400px] border rounded-md">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow><TableHead>Date</TableHead><TableHead>User</TableHead><TableHead>Address</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {dryRun.toSynced.map((s, i) => (
                    <TableRow key={i} className="opacity-70">
                      <TableCell className="text-xs">{s.dateKey || '—'}</TableCell>
                      <TableCell className="text-xs font-medium">{s.userName || s.operative}</TableCell>
                      <TableCell className="text-xs">{s.address}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="delete" className="mt-4">
             <ScrollArea className="h-[400px] border rounded-md">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow><TableHead>Date</TableHead><TableHead>User</TableHead><TableHead>Address</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {dryRun.toDelete.map((s, i) => (
                    <TableRow key={i} className="bg-amber-50">
                      <TableCell className="text-xs">{s.dateKey || '—'}</TableCell>
                      <TableCell className="text-xs font-bold">{s.userName || s.operative}</TableCell>
                      <TableCell className="text-xs">{s.address}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </TabsContent>
        </Tabs>

        <div className="flex justify-between items-center bg-muted/50 p-4 rounded-lg border">
          <Button variant="ghost" onClick={() => setDryRun(null)}>Reset</Button>
          <Button onClick={handleFinalPublish} disabled={isPublishing}>
            {isPublishing ? <Spinner /> : <><CheckCircle2 className="mr-2 h-4 w-4" /> Publish Changes</>}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Gas Planner</CardTitle></CardHeader>
        <CardContent><FileUploader title="Gas Planner" department="Gas" onImportComplete={handleImportComplete} onFileSelect={() => setDryRun(null)} /></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Build Planner</CardTitle></CardHeader>
        <CardContent><FileUploader title="Build Planner" department="Build" onImportComplete={handleImportComplete} onFileSelect={() => setDryRun(null)} /></CardContent>
      </Card>
    </div>
  );
}
