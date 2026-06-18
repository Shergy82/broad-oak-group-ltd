'use client';

import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FileUploader } from './file-uploader';
import type { UserProfile, Shift } from '@/types';
import { Button } from '@/components/ui/button';
import { db, functions, httpsCallable } from '@/lib/firebase';
import { collection, addDoc, serverTimestamp, getDocs } from 'firebase/firestore';
import { type UnifiedParseResult } from '@/lib/exceljs-parser';
import { type StandardShift } from '@/lib/importer/types';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { ScrollArea } from '@/components/ui/scroll-area';
import { RotateCw, CheckCircle2 } from 'lucide-react';
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

function serializeDate(value: any): string {
  if (!value) throw new Error('Invalid date: empty value');
  if (value instanceof Date) return value.toISOString();
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  const d = new Date(value);
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  throw new Error(`Invalid date: ${JSON.stringify(value)}`);
}

function getDateForDisplay(value: any): Date {
  if (value instanceof Date) return value;
  if (typeof value?.toDate === 'function') return value.toDate();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

export function ShiftImporter({ userProfile }: ShiftImporterProps) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [dryRun, setDryRun] = useState<DryRunResult | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);

  useEffect(() => {
    getDocs(collection(db, 'users')).then((snap) => {
      setAllUsers(snap.docs.map((d) => ({ uid: d.id, ...d.data() } as UserProfile)));
    });
  }, []);

  const userNameMap = useMemo(
    () => new Map(allUsers.map((u) => [u.uid, u.name])),
    [allUsers]
  );

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
        toCreate: dryRun.toCreate.map((s) => ({ ...s, date: serializeDate(s.date) })),
        toUpdate: dryRun.toUpdate.map(({ id, new: n }) => ({ id, new: { ...n, date: serializeDate(n.date) } })),
        toDelete: dryRun.toDelete.map((s) => ({ id: s.id })),
        department: userProfile.department || 'Gas',
        profileId: dryRun.profileId,
      });

      toast({ title: 'Success', description: 'Schedule synchronized successfully.' });
      setDryRun(null);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Sync Failed', description: err?.message || 'Unknown error' });
    } finally {
      setIsPublishing(false);
    }
  };

  if (dryRun) {
    const issues = (dryRun.errors || []).filter(e => e.severity === 'error' || e.severity === 'warning');
    const totalChanges = dryRun.toCreate.length + dryRun.toUpdate.length + dryRun.toDelete.length;

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
            <CardHeader className="p-3"><CardTitle className="text-[10px] text-amber-700 uppercase">Deletions</CardTitle></CardHeader>
            <CardContent className="p-3 pt-0"><p className="text-2xl font-bold text-amber-700">{dryRun.toDelete.length}</p></CardContent>
          </Card>
          <Card className="bg-slate-50 border-slate-200">
            <CardHeader className="p-3"><CardTitle className="text-[10px] text-slate-700 uppercase">Existing</CardTitle></CardHeader>
            <CardContent className="p-3 pt-0"><p className="text-2xl font-bold text-slate-700">{dryRun.toUnchanged.length}</p></CardContent>
          </Card>
          <Card className={cn(issues.length > 0 ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200')}>
            <CardHeader className="p-3"><CardTitle className={cn('text-[10px] uppercase', issues.length > 0 ? 'text-red-700' : 'text-slate-700')}>Issues</CardTitle></CardHeader>
            <CardContent className="p-3 pt-0"><p className={cn('text-2xl font-bold', issues.length > 0 && 'text-red-700')}>{issues.length}</p></CardContent>
          </Card>
        </div>

        <Tabs defaultValue="create" className="w-full">
          <TabsList className="grid w-full grid-cols-5 h-auto">
            <TabsTrigger value="create" className="text-[10px]">New ({dryRun.toCreate.length})</TabsTrigger>
            <TabsTrigger value="update" className="text-[10px]">Updates ({dryRun.toUpdate.length})</TabsTrigger>
            <TabsTrigger value="delete" className="text-[10px]">Remove ({dryRun.toDelete.length})</TabsTrigger>
            <TabsTrigger value="existing" className="text-[10px]">Synced ({dryRun.toUnchanged.length})</TabsTrigger>
            <TabsTrigger value="failed" className={cn('text-[10px]', issues.length > 0 && 'text-red-600')}>Issues ({issues.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="create">
            <ScrollArea className="h-[300px] border rounded-md">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow><TableHead>Date</TableHead><TableHead>User</TableHead><TableHead>Address</TableHead><TableHead>Task</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {dryRun.toCreate.length > 0 ? dryRun.toCreate.map((s, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs">{format(getDateForDisplay(s.date), 'dd/MM/yy')}</TableCell>
                      <TableCell className="font-semibold text-xs text-primary">{s.operative}</TableCell>
                      <TableCell className="text-[10px]">{s.address}</TableCell>
                      <TableCell className="text-[10px] italic">{s.task}</TableCell>
                    </TableRow>
                  )) : <TableRow><TableCell colSpan={4} className="text-center py-10 text-muted-foreground">No new shifts.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="update">
             <ScrollArea className="h-[300px] border rounded-md">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow><TableHead>User</TableHead><TableHead>Address</TableHead><TableHead>Change</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {dryRun.toUpdate.length > 0 ? dryRun.toUpdate.map((u, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs">{u.new.operative}</TableCell>
                      <TableCell className="text-[10px]">{u.new.address}</TableCell>
                      <TableCell className="text-[10px] text-blue-700 italic">{u.new.task}</TableCell>
                    </TableRow>
                  )) : <TableRow><TableCell colSpan={3} className="text-center py-10 text-muted-foreground">No updates.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="delete">
             <ScrollArea className="h-[300px] border rounded-md">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow><TableHead>Date</TableHead><TableHead>User</TableHead><TableHead>Address</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {dryRun.toDelete.length > 0 ? dryRun.toDelete.map((s, i) => (
                    <TableRow key={i} className="bg-amber-50/50">
                      <TableCell className="text-xs">{format(getDateForDisplay(s.date), 'dd/MM/yy')}</TableCell>
                      <TableCell className="text-xs">{userNameMap.get(s.userId) || s.userName}</TableCell>
                      <TableCell className="text-[10px]">{s.address}</TableCell>
                    </TableRow>
                  )) : <TableRow><TableCell colSpan={3} className="text-center py-10 text-muted-foreground">No deletions.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="existing">
             <ScrollArea className="h-[300px] border rounded-md">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow><TableHead>Date</TableHead><TableHead>User</TableHead><TableHead>Address</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {dryRun.toUnchanged.length > 0 ? dryRun.toUnchanged.map((s, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs">{format(getDateForDisplay(s.date), 'dd/MM/yy')}</TableCell>
                      <TableCell className="text-xs">{userNameMap.get(s.userId) || s.userName}</TableCell>
                      <TableCell className="text-[10px]">{s.address}</TableCell>
                    </TableRow>
                  )) : <TableRow><TableCell colSpan={3} className="text-center py-10 text-muted-foreground">No existing shifts matched.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="failed">
            <ScrollArea className="h-[300px] border rounded-md">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow><TableHead>Location</TableHead><TableHead>Reason</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {issues.length > 0 ? issues.map((err, i) => (
                    <TableRow key={i} className="bg-red-50/50">
                      <TableCell className="text-[10px] font-bold">{err.cell || '?'}</TableCell>
                      <TableCell className="text-[10px] font-semibold text-red-700">{err.message}</TableCell>
                    </TableRow>
                  )) : <TableRow><TableCell colSpan={2} className="text-center py-10 text-muted-foreground">No issues found.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </ScrollArea>
          </TabsContent>
        </Tabs>

        <div className="flex justify-between items-center bg-muted/50 p-4 rounded-lg border">
          <Button variant="ghost" onClick={() => setDryRun(null)}>Discard & Reset</Button>
          <div className="flex items-center gap-3">
            <p className="text-xs font-medium text-muted-foreground">Ready to sync {totalChanges} changes</p>
            <Button onClick={handleFinalPublish} disabled={isPublishing}>
              {isPublishing ? <Spinner /> : <><RotateCw className="mr-2 h-4 w-4" /> Publish Changes</>}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Upload Gas Planner</CardTitle><CardDescription>Only Today and Future shifts will be affected.</CardDescription></CardHeader>
        <CardContent><FileUploader title="Gas Planner" department="Gas" onImportComplete={handleImportComplete} onFileSelect={() => setDryRun(null)} userProfile={userProfile} /></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Upload Build Planner</CardTitle><CardDescription>Only Today and Future shifts will be affected.</CardDescription></CardHeader>
        <CardContent><FileUploader title="Build Planner" department="Build" onImportComplete={handleImportComplete} onFileSelect={() => setDryRun(null)} userProfile={userProfile} /></CardContent>
      </Card>
    </div>
  );
}
