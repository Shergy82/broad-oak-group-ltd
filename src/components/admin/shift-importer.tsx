'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FileUploader } from './file-uploader';
import type { UserProfile, Shift } from '@/types';
import { Button } from '@/components/ui/button';
import { functions, httpsCallable } from '@/lib/firebase';
import { type UnifiedParseResult } from '@/lib/exceljs-parser';
import { type StandardShift } from '@/lib/importer/types';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { ScrollArea } from '@/components/ui/scroll-area';
import { RotateCw, CheckCircle2, Info, AlertTriangle } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { Spinner } from '@/components/shared/spinner';

interface DryRunResult extends UnifiedParseResult {
  toCreate: StandardShift[];
  toUpdate: { id: string; old: Shift; new: StandardShift }[];
  toDelete: Shift[];
  toUnchanged: Shift[];
}

interface ShiftImporterProps {
  userProfile: UserProfile;
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

      await reconcileShifts({
        toCreate: dryRun.toCreate,
        toUpdate: dryRun.toUpdate,
        toDelete: dryRun.toDelete.map(s => ({ id: s.id })),
        department: userProfile.department || 'Gas',
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
    const totalChanges = dryRun.toCreate.length + dryRun.toUpdate.length + dryRun.toDelete.length;
    const errors = (dryRun.errors || []).filter(e => e.severity === 'error');

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card className="bg-green-50 border-green-200">
            <CardHeader className="p-3"><CardTitle className="text-[10px] text-green-700 uppercase">New</CardTitle></CardHeader>
            <CardContent className="p-3 pt-0"><p className="text-2xl font-bold text-green-700">{dryRun.toCreate.length}</p></CardContent>
          </Card>
          <Card className="bg-blue-50 border-blue-200">
            <CardHeader className="p-3"><CardTitle className="text-[10px] text-blue-700 uppercase">Updates</CardTitle></CardHeader>
            <CardContent className="p-3 pt-0"><p className="text-2xl font-bold text-blue-700">{dryRun.toUpdate.length}</p></CardContent>
          </Card>
          <Card className="bg-amber-50 border-amber-200">
            <CardHeader className="p-3"><CardTitle className="text-[10px] text-amber-700 uppercase">Removals</CardTitle></CardHeader>
            <CardContent className="p-3 pt-0"><p className="text-2xl font-bold text-amber-700">{dryRun.toDelete.length}</p></CardContent>
          </Card>
          <Card className="bg-slate-50 border-slate-200">
            <CardHeader className="p-3"><CardTitle className="text-[10px] text-slate-700 uppercase">Existing</CardTitle></CardHeader>
            <CardContent className="p-3 pt-0"><p className="text-2xl font-bold text-slate-700">{dryRun.toUnchanged.length}</p></CardContent>
          </Card>
        </div>

        <Tabs defaultValue="create" className="w-full">
          <TabsList className="grid w-full grid-cols-4 h-auto">
            <TabsTrigger value="create" className="text-[11px]">New ({dryRun.toCreate.length})</TabsTrigger>
            <TabsTrigger value="update" className="text-[11px]">Updates ({dryRun.toUpdate.length})</TabsTrigger>
            <TabsTrigger value="existing" className="text-[11px]">Synced ({dryRun.toUnchanged.length})</TabsTrigger>
            <TabsTrigger value="failed" className={cn('text-[11px]', errors.length > 0 && 'text-destructive')}>Errors ({errors.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="create" className="mt-4">
            <ScrollArea className="h-[400px] border rounded-md">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow><TableHead>Date</TableHead><TableHead>User</TableHead><TableHead>Address</TableHead><TableHead>Task</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {dryRun.toCreate.map((s, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs whitespace-nowrap">{format(s.date, 'dd/MM/yy')}</TableCell>
                      <TableCell className="text-xs font-bold">{s.operative}</TableCell>
                      <TableCell className="text-xs">{s.address}</TableCell>
                      <TableCell className="text-xs italic text-muted-foreground">{s.task}</TableCell>
                    </TableRow>
                  ))}
                  {dryRun.toCreate.length === 0 && <TableRow><TableCell colSpan={4} className="text-center py-12 text-muted-foreground">No new shifts identified.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="update" className="mt-4">
            <ScrollArea className="h-[400px] border rounded-md">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow><TableHead>Operative</TableHead><TableHead>Address</TableHead><TableHead>Change Detail</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {dryRun.toUpdate.map((u, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs font-bold">{u.new.operative}</TableCell>
                      <TableCell className="text-xs">{u.new.address}</TableCell>
                      <TableCell className="text-xs text-blue-700">Updating task to: "{u.new.task}"</TableCell>
                    </TableRow>
                  ))}
                  {dryRun.toUpdate.length === 0 && <TableRow><TableCell colSpan={3} className="text-center py-12 text-muted-foreground">No shifts need updating.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="existing" className="mt-4">
            <ScrollArea className="h-[400px] border rounded-md">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow><TableHead>Date</TableHead><TableHead>User</TableHead><TableHead>Address</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {dryRun.toUnchanged.map((s, i) => (
                    <TableRow key={i} className="opacity-70">
                      <TableCell className="text-xs">{format(s.date.toDate(), 'dd/MM/yy')}</TableCell>
                      <TableCell className="text-xs">{s.userName}</TableCell>
                      <TableCell className="text-xs">{s.address}</TableCell>
                    </TableRow>
                  ))}
                  {dryRun.toUnchanged.length === 0 && <TableRow><TableCell colSpan={3} className="text-center py-12 text-muted-foreground">No existing shifts matched.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="failed" className="mt-4">
            <ScrollArea className="h-[400px] border rounded-md">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow><TableHead>Location</TableHead><TableHead>Problem</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {errors.map((err, i) => (
                    <TableRow key={i} className="bg-destructive/5">
                      <TableCell className="text-xs font-bold text-destructive">{err.cell || 'Unknown'}</TableCell>
                      <TableCell className="text-xs font-semibold">{err.message}</TableCell>
                    </TableRow>
                  ))}
                  {errors.length === 0 && <TableRow><TableCell colSpan={2} className="text-center py-12 text-muted-foreground">No errors found.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </ScrollArea>
          </TabsContent>
        </Tabs>

        <div className="flex justify-between items-center bg-muted/50 p-4 rounded-lg border">
          <Button variant="ghost" onClick={() => setDryRun(null)}>Cancel & Reset</Button>
          <div className="flex items-center gap-3">
            <p className="text-sm font-medium text-muted-foreground">Total Changes: {totalChanges}</p>
            <Button onClick={handleFinalPublish} disabled={isPublishing || errors.length > 0}>
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
        <CardHeader><CardTitle>Upload Gas Planner</CardTitle></CardHeader>
        <CardContent><FileUploader title="Gas Planner" department="Gas" onImportComplete={handleImportComplete} onFileSelect={() => setDryRun(null)} userProfile={userProfile} /></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Upload Build Planner</CardTitle></CardHeader>
        <CardContent><FileUploader title="Build Planner" department="Build" onImportComplete={handleImportComplete} onFileSelect={() => setDryRun(null)} userProfile={userProfile} /></CardContent>
      </Card>
    </div>
  );
}
