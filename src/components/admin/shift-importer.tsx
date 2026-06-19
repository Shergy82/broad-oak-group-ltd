'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FileUploader } from './file-uploader';
import type { UserProfile, Shift } from '@/types';
import { Button } from '@/components/ui/button';
import { functions, httpsCallable } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CheckCircle2, AlertCircle, Trash2, Info, RefreshCw, Layers, History, HelpCircle } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { Spinner } from '@/components/shared/spinner';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface DryRunResult {
  toCreate: any[];
  toUpdate: { id: string; old: Shift; new: any; changes: { field: string; old: string; new: string }[] }[];
  toDelete: Shift[];
  toSynced: (Shift & { _isBackfill?: boolean; _newMetadata?: any })[];
  toIssues: any[];
  profileId: string;
  profileName: string;
}

interface ShiftImporterProps {
  userProfile: UserProfile;
}

/**
 * 🔒 HUMAN-FRIENDLY FIELD LABELS
 */
const fieldLabels: Record<string, string> = {
  operativeUid: "Assigned operative",
  userId: "User ID",
  userName: "User Name",
  operative: "Operative Name",
  dateKey: "Date",
  type: "Shift Type",
  startTime: "Start Time",
  endTime: "End Time",
  address: "Property Address",
  contract: "Contract/Scheme",
  eNumber: "E Number",
  task: "Task Name",
  descriptionOfWorks: "Description of Works",
  manager: "Manager",
  room: "Room/Location",
};

/**
 * 🔒 SMART SNIPPET GENERATOR
 */
function renderValueDiff(field: string, oldVal: string, newVal: string) {
  const snippet = (val: string, max = 80) => {
    if (!val || val === "(blank)") return "blank";
    return val.length > max ? val.slice(0, max) + "..." : val;
  };

  const label = fieldLabels[field] || field;

  return (
    <div className="flex flex-col gap-0.5 py-1.5 border-b last:border-b-0 border-muted-foreground/10">
      <span className="text-[10px] font-bold text-muted-foreground uppercase">{label}</span>
      <div className="flex items-center gap-2 text-xs">
        <span className="line-through text-red-600 opacity-70 whitespace-pre-wrap">{snippet(oldVal)}</span>
        <span className="text-muted-foreground">→</span>
        <span className="text-green-700 font-bold bg-green-50 px-1.5 py-0.5 rounded whitespace-pre-wrap">{snippet(newVal)}</span>
      </div>
    </div>
  );
}

export function ShiftImporter({ userProfile }: ShiftImporterProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);

  const handleImportComplete = (result: DryRunResult) => {
    setDryRun(result);
  };

  const handleFinalPublish = async () => {
    if (!dryRun || !user) return;
    setIsPublishing(true);

    try {
      if (!functions) throw new Error('Functions not available');
      const reconcileShifts = httpsCallable(functions, 'reconcileShifts');

      const backfillPayload = dryRun.toSynced
        .filter(s => s._isBackfill && s._newMetadata)
        .map(s => ({ id: s.id, new: s._newMetadata }));

      const allUpdates = [...dryRun.toUpdate.map(u => ({ id: u.id, new: u.new })), ...backfillPayload];

      await reconcileShifts({
        toCreate: dryRun.toCreate,
        toUpdate: allUpdates,
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
    const totalActions = dryRun.toCreate.length + dryRun.toUpdate.length + dryRun.toDelete.length;

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <Card className="bg-green-50 border-green-200">
            <CardHeader className="p-3"><CardTitle className="text-[10px] text-green-700 uppercase">New</CardTitle></CardHeader>
            <CardContent className="p-3 pt-0"><p className="text-2xl font-bold text-green-700">{dryRun.toCreate.length}</p></CardContent>
          </Card>
          <Card className="bg-blue-50 border-blue-200">
            <CardHeader className="p-3"><CardTitle className="text-[10px] text-blue-700 uppercase">Updates</CardTitle></CardHeader>
            <CardContent className="p-3 pt-0"><p className="text-2xl font-bold text-blue-700">{dryRun.toUpdate.length}</p></CardContent>
          </Card>
          <Card className="bg-amber-50 border-amber-200">
            <CardHeader className="p-3"><CardTitle className="text-[10px] text-amber-700 uppercase">Remove</CardTitle></CardHeader>
            <CardContent className="p-3 pt-0"><p className="text-2xl font-bold text-amber-700">{dryRun.toDelete.length}</p></CardContent>
          </Card>
          <Card className="bg-slate-50 border-slate-200">
            <CardHeader className="p-3"><CardTitle className="text-[10px] text-slate-700 uppercase">Synced</CardTitle></CardHeader>
            <CardContent className="p-3 pt-0"><p className="text-2xl font-bold text-slate-700">{dryRun.toSynced.length}</p></CardContent>
          </Card>
          <Card className={cn(dryRun.toIssues.length > 0 ? "bg-red-50 border-red-200" : "bg-slate-50 border-slate-200")}>
            <CardHeader className="p-3"><CardTitle className="text-[10px] uppercase">Issues</CardTitle></CardHeader>
            <CardContent className="p-3 pt-0"><p className="text-2xl font-bold">{dryRun.toIssues.length}</p></CardContent>
          </Card>
        </div>

        <Tabs defaultValue="create" className="w-full">
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
                  {dryRun.toUpdate.map((u, i) => (
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
                          {u.changes.map((c, idx) => (
                              <div key={idx}>
                                  {renderValueDiff(c.field, c.old, c.new)}
                              </div>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
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
                    <TableHead className="w-12">Row</TableHead>
                    <TableHead className="w-24">Sheet</TableHead>
                    <TableHead>Operative</TableHead>
                    <TableHead className="w-24">Date</TableHead>
                    <TableHead>Address / Task</TableHead>
                    <TableHead className="text-right">Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dryRun.toIssues.map((err, i) => (
                    <TableRow key={i} className="bg-red-50/50 hover:bg-red-50 transition-colors">
                      <TableCell className="text-[10px] font-bold text-red-800">{err.cell || err.row || '—'}</TableCell>
                      <TableCell className="text-[10px] text-muted-foreground truncate max-w-[100px]">{err.sheet || '—'}</TableCell>
                      <TableCell className="text-xs font-semibold">{err.operative || 'Missing'}</TableCell>
                      <TableCell className="text-[10px]">{err.date || '—'}</TableCell>
                      <TableCell className="text-[10px] leading-tight">
                        <div className="flex flex-col">
                            <span className="truncate max-w-[200px]">{err.address || '—'}</span>
                            <span className="italic opacity-60 truncate max-w-[200px]">{err.task || '—'}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="destructive" className="text-[9px] font-bold uppercase tracking-tight py-0">
                          {err.message}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {dryRun.toIssues.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">No import issues found.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="synced" className="mt-4">
            <ScrollArea className="h-[400px] border rounded-md">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow><TableHead>Date</TableHead><TableHead>User</TableHead><TableHead>Address</TableHead><TableHead className="text-right">Status</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {dryRun.toSynced.map((s, i) => (
                    <TableRow key={i} className="opacity-70">
                      <TableCell className="text-xs whitespace-nowrap">{s.dateKey || (s.date?.toDate ? format(s.date.toDate(), 'dd/MM/yy') : '—')}</TableCell>
                      <TableCell className="text-xs font-medium">{s.userName || s.operative}</TableCell>
                      <TableCell className="text-xs">{s.address}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant="outline" className="text-[9px] uppercase">{s._isBackfill ? 'Backfill Required' : 'Synced'}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {dryRun.toSynced.length === 0 && <TableRow><TableCell colSpan={4} className="text-center py-12 text-muted-foreground">No existing matches found.</TableCell></TableRow>}
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
                      <TableCell className="text-xs whitespace-nowrap">{s.dateKey || format(new Date(s.date), 'dd/MM/yy')}</TableCell>
                      <TableCell className="text-xs font-bold">{s.operative}</TableCell>
                      <TableCell className="text-xs">{s.address}</TableCell>
                      <TableCell className="text-xs italic text-muted-foreground">{s.task}</TableCell>
                    </TableRow>
                  ))}
                  {dryRun.toCreate.length === 0 && <TableRow><TableCell colSpan={4} className="text-center py-12 text-muted-foreground">No new shifts.</TableCell></TableRow>}
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
                      <TableCell className="text-xs">{s.dateKey || (s.date?.toDate ? format(s.date.toDate(), 'dd/MM/yy') : '—')}</TableCell>
                      <TableCell className="text-xs font-bold">{s.userName}</TableCell>
                      <TableCell className="text-xs">{s.address}</TableCell>
                    </TableRow>
                  ))}
                  {dryRun.toDelete.length === 0 && <TableRow><TableCell colSpan={3} className="text-center py-12 text-muted-foreground">No removals identified.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </ScrollArea>
          </TabsContent>
        </Tabs>

        <div className="flex justify-between items-center bg-muted/50 p-4 rounded-lg border">
          <Button variant="ghost" onClick={() => setDryRun(null)}>Reset</Button>
          <div className="flex items-center gap-3">
            <p className="text-sm font-medium text-muted-foreground">Changes to Publish: {totalActions}</p>
            <Button onClick={handleFinalPublish} disabled={isPublishing || dryRun.toIssues.length > 0}>
              {isPublishing ? <Spinner /> : <><CheckCircle2 className="mr-2 h-4 w-4" /> Publish Changes</>}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Gas Planner</CardTitle></CardHeader>
        <CardContent><FileUploader title="Gas Planner" department="Gas" onImportComplete={handleImportComplete} onFileSelect={() => setDryRun(null)} userProfile={userProfile} /></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Build Planner</CardTitle></CardHeader>
        <CardContent><FileUploader title="Build Planner" department="Build" onImportComplete={handleImportComplete} onFileSelect={() => setDryRun(null)} userProfile={userProfile} /></CardContent>
      </Card>
    </div>
  );
}
