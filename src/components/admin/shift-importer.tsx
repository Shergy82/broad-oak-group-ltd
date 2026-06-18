'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FileUploader } from './file-uploader';
import type { UserProfile, Shift } from '@/types';
import { Button } from '@/components/ui/button';
import { db, functions, httpsCallable } from '@/lib/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { type UnifiedParseResult } from '@/lib/exceljs-parser';
import { type StandardShift } from '@/lib/importer/types';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AlertCircle, FileSearch, CheckCircle, Info, HelpCircle, Table as TableIcon, LayoutGrid, RotateCw, PlusCircle, Trash2, UserCheck, MapPin } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

interface DryRunResult extends UnifiedParseResult {
    toCreate: StandardShift[];
    toUpdate: { id: string, old: Shift, new: StandardShift }[];
    toDelete: Shift[];
}

interface ShiftImporterProps {
  userProfile: UserProfile;
}

export function ShiftImporter({ userProfile }: ShiftImporterProps) {
  const { user } = useAuth();
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const { toast } = useToast();

  const handleImportComplete = (result: DryRunResult) => {
    setDryRun(result);
  };

  const handleFinalPublish = async () => {
    if (!dryRun || !user) return;
    setIsPublishing(true);

    try {
      if (!functions) throw new Error("Functions not available");
      const reconcileShifts = httpsCallable(functions, 'reconcileShifts');
      
      await reconcileShifts({
        toCreate: dryRun.toCreate.map(s => ({
          ...s,
          date: s.date.toISOString(),
          status: 'pending-confirmation',
          source: 'import',
          plannerName: dryRun.profileId
        })),
        toUpdate: dryRun.toUpdate.map(u => ({
          id: u.id,
          new: { ...u.new, date: u.new.date.toISOString() }
        })),
        toDelete: dryRun.toDelete,
        department: userProfile.department || 'Gas'
      });

      await addDoc(collection(db, 'import_logs'), {
        fileName: dryRun.profileId,
        importerUid: user.uid,
        importerName: userProfile.name,
        profileId: dryRun.profileId,
        newCount: dryRun.toCreate.length,
        updateCount: dryRun.toUpdate.length,
        deleteCount: dryRun.toDelete.length,
        timestamp: serverTimestamp(),
        result: 'success'
      });

      toast({ title: 'Success', description: 'Schedule synchronized successfully.' });
      setDryRun(null);
    } catch (err: any) {
      console.error("Publish failed:", err);
      toast({ variant: 'destructive', title: 'Sync Failed', description: err.message });
    } finally {
      setIsPublishing(false);
    }
  };

  const renderDryRunResults = (dryRun: DryRunResult) => {
    const hasChanges = dryRun.toCreate.length > 0 || dryRun.toUpdate.length > 0 || dryRun.toDelete.length > 0;
    const dateSort = (a: any, b: any) => {
        const d1 = a.date instanceof Date ? a.date : (a.date?.toDate ? a.date.toDate() : new Date(a.date));
        const d2 = b.date instanceof Date ? b.date : (b.date?.toDate ? b.date.toDate() : new Date(b.date));
        return d1.getTime() - d2.getTime();
    };

    const sortedNew = [...dryRun.toCreate].sort(dateSort);
    const sortedUpdates = [...dryRun.toUpdate].sort((a,b) => dateSort(a.new, b.new));
    const sortedDeletions = [...dryRun.toDelete].sort(dateSort);
    const sortedFailed = [...dryRun.errors].filter(e => e.severity === 'error' || e.severity === 'warning').sort((a,b) => (a.row || 0) - (b.row || 0));

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card className="bg-green-50 border-green-200"><CardHeader className="p-3"><CardTitle className="text-xs text-green-700 uppercase">New</CardTitle></CardHeader><CardContent className="p-3 pt-0"><p className="text-2xl font-bold text-green-700">{dryRun.toCreate.length}</p></CardContent></Card>
                <Card className="bg-blue-50 border-blue-200"><CardHeader className="p-3"><CardTitle className="text-xs text-blue-700 uppercase">Updates</CardTitle></CardHeader><CardContent className="p-3 pt-0"><p className="text-2xl font-bold text-blue-700">{dryRun.toUpdate.length}</p></CardContent></Card>
                <Card className="bg-amber-50 border-amber-200"><CardHeader className="p-3"><CardTitle className="text-xs text-amber-700 uppercase">Deletions</CardTitle></CardHeader><CardContent className="p-3 pt-0"><p className="text-2xl font-bold text-amber-700">{dryRun.toDelete.length}</p></CardContent></Card>
                <Card className="bg-red-50 border-red-200"><CardHeader className="p-3"><CardTitle className="text-xs text-red-700 uppercase">Failed</CardTitle></CardHeader><CardContent className="p-3 pt-0"><p className="text-2xl font-bold text-red-700">{sortedFailed.length}</p></CardContent></Card>
            </div>

            <Tabs defaultValue="create" className="w-full">
                <TabsList className="grid w-full grid-cols-4">
                    <TabsTrigger value="create">New</TabsTrigger>
                    <TabsTrigger value="update">Updates</TabsTrigger>
                    <TabsTrigger value="delete">Deletions</TabsTrigger>
                    <TabsTrigger value="fail">Failed ({sortedFailed.length})</TabsTrigger>
                </TabsList>
                
                <TabsContent value="create">
                    <ScrollArea className="h-[400px] border rounded-md">
                        <Table>
                            <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>User</TableHead><TableHead>Site Address</TableHead><TableHead>Task</TableHead></TableRow></TableHeader>
                            <TableBody>
                                {sortedNew.map((s, i) => (
                                    <TableRow key={i}>
                                        <TableCell className="text-xs">{format(s.date, 'dd/MM/yy')}</TableCell>
                                        <TableCell className="font-semibold text-xs text-primary">{s.operative}</TableCell>
                                        <TableCell className="text-[10px]">{s.address}</TableCell>
                                        <TableCell className="text-[10px] italic">{s.task}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </ScrollArea>
                </TabsContent>

                <TabsContent value="update">
                    <ScrollArea className="h-[400px] border rounded-md">
                        <Table>
                            <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>User</TableHead><TableHead>Task (New)</TableHead></TableRow></TableHeader>
                            <TableBody>
                                {sortedUpdates.map((u, i) => (
                                    <TableRow key={i}>
                                        <TableCell className="text-xs">{format(u.new.date, 'dd/MM/yy')}</TableCell>
                                        <TableCell className="text-xs">{u.new.operative}</TableCell>
                                        <TableCell className="text-[10px] font-medium text-blue-700">{u.new.task}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </ScrollArea>
                </TabsContent>

                <TabsContent value="delete">
                    <ScrollArea className="h-[400px] border rounded-md">
                        <Table>
                            <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>User</TableHead><TableHead>Address</TableHead></TableRow></TableHeader>
                            <TableBody>
                                {sortedDeletions.map((s, i) => (
                                    <TableRow key={i} className="bg-amber-50">
                                        <TableCell className="text-xs">{format(s.date.toDate(), 'dd/MM/yy')}</TableCell>
                                        <TableCell className="text-xs">{s.userName}</TableCell>
                                        <TableCell className="text-[10px]">{s.address}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </ScrollArea>
                </TabsContent>

                <TabsContent value="fail">
                    <ScrollArea className="h-[400px] border rounded-md p-4">
                        <div className="space-y-4">
                            {sortedFailed.length > 0 ? sortedFailed.map((err, i) => (
                                <div key={i} className="p-3 border-l-4 border-red-500 bg-red-50 rounded-r-md">
                                    <div className="flex justify-between items-center mb-1">
                                        <Badge variant="destructive" className="text-[10px]">{err.cell || `Row ${err.row}`}</Badge>
                                        <span className="text-[10px] text-muted-foreground">{err.sheet}</span>
                                    </div>
                                    <p className="text-sm font-medium">{err.message}</p>
                                </div>
                            )) : <p className="text-center text-muted-foreground py-10">No data quality issues found.</p>}
                        </div>
                    </ScrollArea>
                </TabsContent>
            </Tabs>

            <div className="flex justify-between items-center bg-muted/50 p-4 rounded-lg border">
                <div className="flex items-center gap-3">
                    <div className={cn("p-2 rounded-full", sortedFailed.some(e => e.severity === 'error') ? "bg-red-100" : "bg-green-100")}>
                        {sortedFailed.some(e => e.severity === 'error') ? <AlertCircle className="text-red-600" /> : <CheckCircle className="text-green-600" />}
                    </div>
                    <div>
                        <p className="font-bold">{sortedFailed.some(e => e.severity === 'error') ? "Fix required before sync" : "Validation passed"}</p>
                        <p className="text-xs text-muted-foreground">Historical records (past dates) and other planners are protected.</p>
                    </div>
                </div>
                <div className="flex gap-3">
                    <Button variant="ghost" onClick={() => setDryRun(null)}>Discard</Button>
                    <Button onClick={handleFinalPublish} disabled={isPublishing || sortedFailed.some(e => e.severity === 'error')}>
                        {isPublishing ? <Spinner /> : <><RotateCw className="mr-2 h-4 w-4" /> Publish Changes</>}
                    </Button>
                </div>
            </div>
        </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold tracking-tight">Shift Importer</h2>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm"><HelpCircle className="mr-2 h-4 w-4" /> Format Guide</Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl">
            <DialogHeader><DialogTitle>Planner Layout Guide</DialogTitle></DialogHeader>
            <ScrollArea className="max-h-[70vh] pr-4">
              <div className="space-y-8 py-4">
                <div className="space-y-3">
                  <div className="flex items-center gap-2 font-semibold text-primary"><TableIcon className="h-5 w-5" /><h3>Standard Tabular (Build/Generic)</h3></div>
                  <p className="text-sm text-muted-foreground">Traditional table where each row is a single shift.</p>
                  <div className="border rounded-md p-4 bg-muted/30">
                    <table className="w-full text-xs border-collapse"><thead><tr className="bg-muted border-b"><th className="p-2 border-r text-left">Date</th><th className="p-2 border-r text-left">Staff</th><th className="p-2 text-left">Site Address</th></tr></thead><tbody><tr className="border-b bg-background"><td className="p-2 border-r">01/10/24</td><td className="p-2 border-r">John Smith</td><td className="p-2">123 Main St</td></tr></tbody></table>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center gap-2 font-semibold text-sky-600"><LayoutGrid className="h-5 w-5" /><h3>Gas Battleship Layout</h3></div>
                  <p className="text-sm text-muted-foreground">Site blocks separated by colored lines. Dates across the top (Col F+).</p>
                  <div className="border rounded-md p-4 bg-muted/30">
                    <div className="h-2 bg-black w-full rounded-sm opacity-50 mb-1" />
                    <table className="w-full text-[10px] border-collapse bg-background"><thead><tr className="bg-muted/50 border-b"><th className="p-1 border-r text-left w-1/4">Col A (Site)</th><th className="p-1 border-r text-center">15/06</th><th className="p-1 text-center">16/06</th></tr></thead><tbody><tr className="border-b"><td className="p-1 border-r font-bold">16 Hints Meadow</td><td className="p-1 border-r text-center">Lightbulb - Phil S</td><td className="p-1 text-center">Sink - Tom S</td></tr></tbody></table>
                  </div>
                </div>
              </div>
            </ScrollArea>
          </DialogContent>
        </Dialog>
      </div>

      {!dryRun ? (
        <Card>
          <CardHeader>
            <CardTitle>Verify Planner</CardTitle>
            <CardDescription>Upload your planner to run a safe diagnostic test. No changes will be made until you confirm the results.</CardDescription>
          </CardHeader>
          <CardContent>
            <FileUploader onImportComplete={handleImportComplete} onFileSelect={() => setDryRun(null)} userProfile={userProfile} />
          </CardContent>
        </Card>
      ) : renderDryRunResults(dryRun)}
    </div>
  );
}
