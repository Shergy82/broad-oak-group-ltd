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
import { CheckCircle2, MapPin, Calendar, Users, FileText, XCircle, Search } from 'lucide-react';
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

function snippet(value: string, max = 80) {
  if (!value) return "blank";
  const str = String(value);
  return str.length > max ? str.slice(0, max) + "..." : str;
}

/**
 * Strips the operative's name from the end of the description for clean UI display.
 */
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
        <span className="line-through text-red-600 opacity-70 decoration-1">
          {snippet(displayOld)}
        </span>
        <span className="text-muted-foreground text-xs">→</span>
        <span className="rounded bg-green-50 px-2 py-0.5 font-medium text-green-700">
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

  // Automatically switch to meaningful tab when data arrives
  useEffect(() => {
    if (dryRun) {
      if (dryRun.toIssues.length > 0) setActiveTab('issues');
      else if (dryRun.toCreate.length > 0) setActiveTab('create');
      else if (dryRun.toUpdate.length > 0) setActiveTab('update');
      else if (dryRun.toDelete.length > 0) setActiveTab('delete');
      else setActiveTab('synced');
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
      const reconcileShiftsFn = httpsCallable(functions, 'reconcileShifts');

      await reconcileShiftsFn({
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
    const summaryCards = [
      { key: 'create', label: 'New', count: dryRun.toCreate.length, ring: 'ring-green-500', bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700' },
      { key: 'update', label: 'Updates', count: dryRun.toUpdate.length, ring: 'ring-blue-500', bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700' },
      { key: 'delete', label: 'Remove', count: dryRun.toDelete.length, ring: 'ring-amber-500', bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700' },
      { key: 'synced', label: 'Synced', count: dryRun.toSynced.length, ring: 'ring-slate-500', bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-700' },
      { key: 'issues', label: 'Issues', count: dryRun.toIssues.length, ring: 'ring-red-500', bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700' }
    ];

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {summaryCards.map((card) => (
            <Card 
              key={card.key}
              role="button"
              tabIndex={0}
              onClick={() => setActiveTab(card.key)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setActiveTab(card.key); }}
              className={cn(
                "cursor-pointer transition-all hover:shadow-md hover:scale-[1.01]",
                card.bg, card.border,
                activeTab === card.key && cn("ring-2 shadow-md", card.ring)
              )}
            >
              <CardHeader className="p-3">
                <CardTitle className={cn("text-[10px] uppercase font-bold", card.text)}>{card.label}</CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-0 text-center">
                <p className={cn("text-2xl font-bold", card.text)}>{card.count}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="hidden">
            <TabsTrigger value="create">New</TabsTrigger>
            <TabsTrigger value="update">Updates</TabsTrigger>
            <TabsTrigger value="delete">Remove</TabsTrigger>
            <TabsTrigger value="synced">Synced</TabsTrigger>
            <TabsTrigger value="issues">Issues</TabsTrigger>
          </TabsList>

          <TabsContent value="update" className="mt-0">
            <ScrollArea className="h-[450px] border rounded-md">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow><TableHead>Context</TableHead><TableHead>Changes</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {dryRun.toUpdate.map((u, i) => {
                    const visibleChanges = u.changes.filter(c => !HIDDEN_UPDATE_FIELDS.includes(c.field));
                    if (visibleChanges.length === 0) return null;

                    return (
                      <TableRow key={i}>
                        <TableCell className="text-[10px] leading-tight w-[250px] bg-muted/20">
                          <div className="flex flex-col gap-1.5">
                              <div className="flex items-center gap-1.5"><Users className="h-3 w-3" /><span className="font-bold text-sm text-primary">{u.new.operative || u.new.userName}</span></div>
                              <div className="flex items-center gap-1.5"><Calendar className="h-3 w-3" /><span className="font-medium">{u.new.dateKey}</span></div>
                              <div className="flex items-center gap-1.5"><MapPin className="h-3 w-3" /><span className="italic text-muted-foreground">{snippet(u.new.address, 60)}</span></div>
                          </div>
                        </TableCell>
                        <TableCell className="align-top">
                          <div className="space-y-1">
                            {visibleChanges.map((c, idx) => (
                                <div key={idx}>
                                    {renderValueDiff(c.field, c.old, c.new, u.old.operative || u.old.userName, u.new.operative)}
                                </div>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  }).filter(Boolean)}
                  {dryRun.toUpdate.length === 0 && <TableRow><TableCell colSpan={2} className="text-center py-12 text-muted-foreground">No updates found.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="issues" className="mt-0">
            <ScrollArea className="h-[450px] border rounded-md">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead className="w-24">Location</TableHead>
                    <TableHead>Operative</TableHead>
                    <TableHead className="w-28">Date</TableHead>
                    <TableHead>Work Details</TableHead>
                    <TableHead className="text-right">Failure Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dryRun.toIssues.map((err, i) => (
                    <TableRow key={i} className="bg-red-50/30 hover:bg-red-50 transition-colors">
                      <TableCell className="text-[10px] font-bold text-slate-500 uppercase tracking-tight">
                        <div className="flex flex-col">
                            <span>{err.sourceSheet}</span>
                            <span className="text-primary font-bold">{err.cell || 'Row ' + err.row}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs font-semibold">{err.operative || '—'}</TableCell>
                      <TableCell className="text-[10px] font-medium">{err.date || '—'}</TableCell>
                      <TableCell className="text-[10px] leading-tight py-2">
                        <div className="flex flex-col gap-1">
                            <span className="font-bold text-slate-700">{snippet(err.address || '—', 80)}</span>
                            <span className="italic opacity-70 whitespace-pre-wrap">{snippet(err.task || '—', 100)}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="inline-block rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-bold text-red-700 leading-snug max-w-xs text-left break-words">
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

          <TabsContent value="create" className="mt-0">
            <ScrollArea className="h-[400px] border rounded-md">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow><TableHead>Date</TableHead><TableHead>User</TableHead><TableHead>Address</TableHead><TableHead>Task</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {dryRun.toCreate.map((s, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs font-medium whitespace-nowrap">{s.dateKey}</TableCell>
                      <TableCell className="text-xs font-bold text-primary">{s.operative}</TableCell>
                      <TableCell className="text-xs">{snippet(s.address, 60)}</TableCell>
                      <TableCell className="text-xs italic text-muted-foreground">{snippet(s.task, 60)}</TableCell>
                    </TableRow>
                  ))}
                  {dryRun.toCreate.length === 0 && <TableRow><TableCell colSpan={4} className="text-center py-12 text-muted-foreground">No new shifts found.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="synced" className="mt-0">
             <ScrollArea className="h-[400px] border rounded-md">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow><TableHead>Date</TableHead><TableHead>User</TableHead><TableHead>Address</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {dryRun.toSynced.map((s, i) => (
                    <TableRow key={i} className="opacity-70 bg-muted/10">
                      <TableCell className="text-xs font-medium">{s.dateKey}</TableCell>
                      <TableCell className="text-xs font-medium">{s.userName}</TableCell>
                      <TableCell className="text-xs">{snippet(s.address, 100)}</TableCell>
                    </TableRow>
                  ))}
                  {dryRun.toSynced.length === 0 && <TableRow><TableCell colSpan={3} className="text-center py-12 text-muted-foreground">No matching shifts found.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="delete" className="mt-0">
             <ScrollArea className="h-[400px] border rounded-md">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow><TableHead>Date</TableHead><TableHead>User</TableHead><TableHead>Address</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {dryRun.toDelete.map((s, i) => (
                    <TableRow key={i} className="bg-amber-50/50">
                      <TableCell className="text-xs font-medium">{s.dateKey}</TableCell>
                      <TableCell className="text-xs font-bold text-amber-900">{s.userName}</TableCell>
                      <TableCell className="text-xs">{snippet(s.address, 100)}</TableCell>
                    </TableRow>
                  ))}
                  {dryRun.toDelete.length === 0 && <TableRow><TableCell colSpan={3} className="text-center py-12 text-muted-foreground">No shifts to remove.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </ScrollArea>
          </TabsContent>
        </Tabs>

        <div className="flex justify-between items-center bg-muted/30 p-4 rounded-xl border-2 border-dashed border-muted-foreground/20">
          <Button variant="ghost" onClick={() => setDryRun(null)} disabled={isPublishing}>Cancel & Reset</Button>
          <div className="flex items-center gap-4">
            <div className="text-right hidden sm:block">
                <p className="text-sm font-bold">{dryRun.toCreate.length + dryRun.toUpdate.length + dryRun.toDelete.length} actions pending</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold">Today & Future only</p>
            </div>
            <Button size="lg" onClick={handleFinalPublish} disabled={isPublishing} className="shadow-lg">
              {isPublishing ? <Spinner className="mr-2" /> : <><CheckCircle2 className="mr-2 h-4 w-4" /> Publish Final Schedule</>}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" /> Gas Planner Reconciliation</CardTitle></CardHeader>
        <CardContent><FileUploader title="Gas Planner" department="Gas" onImportComplete={handleImportComplete} onFileSelect={() => setDryRun(null)} /></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Building2Icon className="h-5 w-5" /> Build Planner Reconciliation</CardTitle></CardHeader>
        <CardContent><FileUploader title="Build Planner" department="Build" onImportComplete={handleImportComplete} onFileSelect={() => setDryRun(null)} /></CardContent>
      </Card>
    </div>
  );
}

const Building2Icon = ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/></svg>
);
