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
import { CheckCircle2, AlertCircle, Trash2, Info, RefreshCw } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { Spinner } from '@/components/shared/spinner';

interface DryRunResult {
  toCreate: any[];
  toUpdate: { id: string; old: Shift; new: any }[];
  toDelete: Shift[];
  toSynced: Shift[];
  toIssues: any[];
  profileId: string;
  profileName: string;
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
        profileId: dryRun.profileId
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
            <TabsTrigger value="issues" className={cn('text-[11px]', dryRun.toIssues.length > 0 && 'text-destructive')}>Issues</TabsTrigger>
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
                      <TableCell className="text-xs whitespace-nowrap">{format(new Date(s.date), 'dd/MM/yy')}</TableCell>
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

          <TabsContent value="update" className="mt-4">
            <ScrollArea className="h-[400px] border rounded-md">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow><TableHead>Operative</TableHead><TableHead>Address</TableHead><TableHead>Changes</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {dryRun.toUpdate.map((u, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs font-bold">{u.new.operative}</TableCell>
                      <TableCell className="text-xs">{u.new.address}</TableCell>
                      <TableCell className="text-xs text-blue-700">Updating metadata fields.</TableCell>
                    </TableRow>
                  ))}
                  {dryRun.toUpdate.length === 0 && <TableRow><TableCell colSpan={3} className="text-center py-12 text-muted-foreground">No updates needed.</TableCell></TableRow>}
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
                      <TableCell className="text-xs">{format(s.date.toDate(), 'dd/MM/yy')}</TableCell>
                      <TableCell className="text-xs font-bold">{s.userName}</TableCell>
                      <TableCell className="text-xs">{s.address}</TableCell>
                    </TableRow>
                  ))}
                  {dryRun.toDelete.length === 0 && <TableRow><TableCell colSpan={3} className="text-center py-12 text-muted-foreground">No removals identified.</TableCell></TableRow>}
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
                    <TableRow key={i} className="opacity-60">
                      <TableCell className="text-xs">{format(s.date.toDate(), 'dd/MM/yy')}</TableCell>
                      <TableCell className="text-xs">{s.userName}</TableCell>
                      <TableCell className="text-xs">{s.address}</TableCell>
                    </TableRow>
                  ))}
                  {dryRun.toSynced.length === 0 && <TableRow><TableCell colSpan={3} className="text-center py-12 text-muted-foreground">No matching shifts found.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="issues" className="mt-4">
            <ScrollArea className="h-[400px] border rounded-md">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow><TableHead>Location</TableHead><TableHead>Problem</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {dryRun.toIssues.map((err, i) => (
                    <TableRow key={i} className="bg-red-50">
                      <TableCell className="text-xs font-bold text-red-700">{err.cell || 'Row ' + err.row}</TableCell>
                      <TableCell className="text-xs font-semibold text-red-700">{err.message}</TableCell>
                    </TableRow>
                  ))}
                  {dryRun.toIssues.length === 0 && <TableRow><TableCell colSpan={2} className="text-center py-12 text-muted-foreground">No blocking issues.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </ScrollArea>
          </TabsContent>
        </Tabs>

        <div className="flex justify-between items-center bg-muted/50 p-4 rounded-lg border">
          <Button variant="ghost" onClick={() => setDryRun(null)}>Reset</Button>
          <div className="flex items-center gap-3">
            <p className="text-sm font-medium text-muted-foreground">Total Actions: {totalActions}</p>
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
