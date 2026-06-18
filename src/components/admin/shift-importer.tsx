
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
import { 
    AlertCircle, 
    FileSearch, 
    CheckCircle, 
    Info, 
    HelpCircle, 
    Table as TableIcon, 
    LayoutGrid, 
    RotateCw,
    XCircle,
    UserCheck,
    MapPin,
    Search,
    Eye,
    EyeOff
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { Spinner } from '@/components/shared/spinner';

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
  const [showTechnicalLog, setShowTechnicalLog] = useState(false);
  const { toast } = useToast();
  
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);

  useEffect(() => {
    getDocs(collection(db, 'users')).then(snap => {
      setAllUsers(snap.docs.map(d => ({ uid: d.id, ...d.data() } as UserProfile)));
    });
  }, []);

  const userNameMap = useMemo(() => new Map(allUsers.map(u => [u.uid, u.name])), [allUsers]);

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
    const notImported = (dryRun.errors || []).filter(err => 
        err.severity === 'error' || 
        err.severity === 'warning' ||
        ['OPERATIVE_MISSING', 'PROPERTY_MISSING', 'USER_NOT_FOUND', 'INVALID_DATE', 'MISSING_ADDRESS'].includes(err.code)
    );
    const technicalLogs = (dryRun.errors || []).filter(err => !notImported.includes(err));

    const dateSort = (a: any, b: any) => {
        const itemA = a.new || a;
        const itemB = b.new || b;
        const d1 = itemA.date instanceof Date ? itemA.date : (itemA.date?.toDate ? itemA.date.toDate() : new Date(itemA.date));
        const d2 = itemB.date instanceof Date ? itemB.date : (itemB.date?.toDate ? itemB.date.toDate() : new Date(itemB.date));
        return d1.getTime() - d2.getTime();
    };

    const sortedNew = [...(dryRun.toCreate || [])].sort(dateSort);
    const sortedUpdates = [...(dryRun.toUpdate || [])].sort(dateSort);
    const sortedDeletions = [...(dryRun.toDelete || [])].sort(dateSort);
    const sortedNotImported = [...notImported].sort((a,b) => (a.row || 0) - (b.row || 0));

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card className="bg-green-50 border-green-200">
                    <CardHeader className="p-3"><CardTitle className="text-xs text-green-700 uppercase">New</CardTitle></CardHeader>
                    <CardContent className="p-3 pt-0"><p className="text-2xl font-bold text-green-700">{sortedNew.length}</p></CardContent>
                </Card>
                <Card className="bg-blue-50 border-blue-200">
                    <CardHeader className="p-3"><CardTitle className="text-xs text-blue-700 uppercase">Updates</CardTitle></CardHeader>
                    <CardContent className="p-3 pt-0"><p className="text-2xl font-bold text-blue-700">{sortedUpdates.length}</p></CardContent>
                </Card>
                <Card className="bg-amber-50 border-amber-200">
                    <CardHeader className="p-3"><CardTitle className="text-xs text-amber-700 uppercase">Deletions</CardTitle></CardHeader>
                    <CardContent className="p-3 pt-0"><p className="text-2xl font-bold text-amber-700">{sortedDeletions.length}</p></CardContent>
                </Card>
                <Card className={cn(sortedNotImported.length > 0 ? "bg-red-50 border-red-200" : "bg-slate-50 border-slate-200")}>
                    <CardHeader className="p-3"><CardTitle className={cn("text-xs uppercase", sortedNotImported.length > 0 ? "text-red-700" : "text-slate-700")}>Not Imported</CardTitle></CardHeader>
                    <CardContent className="p-3 pt-0"><p className={cn("text-2xl font-bold", sortedNotImported.length > 0 ? "text-red-700" : "text-slate-700")}>{sortedNotImported.length}</p></CardContent>
                </Card>
            </div>

            <Tabs defaultValue={sortedNew.length > 0 ? "create" : sortedNotImported.length > 0 ? "failed" : "update"} className="w-full">
                <TabsList className="grid w-full grid-cols-4">
                    <TabsTrigger value="create">New ({sortedNew.length})</TabsTrigger>
                    <TabsTrigger value="update">Updates ({sortedUpdates.length})</TabsTrigger>
                    <TabsTrigger value="delete">Deletions ({sortedDeletions.length})</TabsTrigger>
                    <TabsTrigger value="failed" className={cn(sortedNotImported.length > 0 && "text-red-600")}>Not Imported ({sortedNotImported.length})</TabsTrigger>
                </TabsList>
                
                <TabsContent value="create">
                    <ScrollArea className="h-[400px] border rounded-md">
                        <Table>
                            <TableHeader className="sticky top-0 bg-background z-10">
                                <TableRow>
                                    <TableHead>Date</TableHead>
                                    <TableHead>User</TableHead>
                                    <TableHead>Address</TableHead>
                                    <TableHead>Task</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {sortedNew.length > 0 ? sortedNew.map((s, i) => (
                                    <TableRow key={i}>
                                        <TableCell className="text-xs">{format(s.date, 'dd/MM/yy')}</TableCell>
                                        <TableCell className="font-semibold text-xs text-primary">{s.operative}</TableCell>
                                        <TableCell className="text-[10px] truncate max-w-[150px]">{s.address}</TableCell>
                                        <TableCell className="text-[10px] italic">{s.task}</TableCell>
                                    </TableRow>
                                )) : <TableRow><TableCell colSpan={4} className="text-center py-10 text-muted-foreground">No new shifts extracted.</TableCell></TableRow>}
                            </TableBody>
                        </Table>
                    </ScrollArea>
                </TabsContent>

                <TabsContent value="update">
                    <ScrollArea className="h-[400px] border rounded-md">
                        <Table>
                            <TableHeader className="sticky top-0 bg-background z-10">
                                <TableRow>
                                    <TableHead>Date</TableHead>
                                    <TableHead>User</TableHead>
                                    <TableHead>Task Update</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {sortedUpdates.length > 0 ? sortedUpdates.map((u, i) => (
                                    <TableRow key={i}>
                                        <TableCell className="text-xs">{format(u.new.date, 'dd/MM/yy')}</TableCell>
                                        <TableCell className="text-xs">{u.new.operative}</TableCell>
                                        <TableCell className="text-[10px] font-medium text-blue-700">{u.new.task}</TableCell>
                                    </TableRow>
                                )) : <TableRow><TableCell colSpan={3} className="text-center py-10 text-muted-foreground">No updates needed.</TableCell></TableRow>}
                            </TableBody>
                        </Table>
                    </ScrollArea>
                </TabsContent>

                <TabsContent value="delete">
                    <ScrollArea className="h-[400px] border rounded-md">
                        <Table>
                            <TableHeader className="sticky top-0 bg-background z-10">
                                <TableRow>
                                    <TableHead>Date</TableHead>
                                    <TableHead>User</TableHead>
                                    <TableHead>Address</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {sortedDeletions.length > 0 ? sortedDeletions.map((s, i) => (
                                    <TableRow key={i} className="bg-amber-50">
                                        <TableCell className="text-xs">{format(s.date.toDate(), 'dd/MM/yy')}</TableCell>
                                        <TableCell className="text-xs">{userNameMap.get(s.userId) || 'Unknown'}</TableCell>
                                        <TableCell className="text-[10px]">{s.address}</TableCell>
                                    </TableRow>
                                )) : <TableRow><TableCell colSpan={3} className="text-center py-10 text-muted-foreground">No deletions detected.</TableCell></TableRow>}
                            </TableBody>
                        </Table>
                    </ScrollArea>
                </TabsContent>

                <TabsContent value="failed">
                    <ScrollArea className="h-[400px] border rounded-md">
                        <Table>
                            <TableHeader className="sticky top-0 bg-background z-10">
                                <TableRow>
                                    <TableHead>Date</TableHead>
                                    <TableHead>Cell</TableHead>
                                    <TableHead>Work Found</TableHead>
                                    <TableHead>Reason Not Imported</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {sortedNotImported.length > 0 ? sortedNotImported.map((err, i) => {
                                    const raw = err.rawValues || {};
                                    const date = raw.date ? (raw.date instanceof Date ? raw.date : new Date(raw.date)) : null;
                                    return (
                                        <TableRow key={i} className="bg-red-50/50">
                                            <TableCell className="text-[10px]">{date ? format(date, 'dd/MM/yy') : 'N/A'}</TableCell>
                                            <TableCell className="text-[10px] font-bold">{err.cell || '?'}</TableCell>
                                            <TableCell className="text-[10px] truncate max-w-[200px] italic">"{raw.text || 'Empty'}"</TableCell>
                                            <TableCell className="text-[10px] font-semibold text-red-700">{err.message}</TableCell>
                                        </TableRow>
                                    );
                                }) : <TableRow><TableCell colSpan={4} className="text-center py-10 text-muted-foreground">No problematic entries found.</TableCell></TableRow>}
                            </TableBody>
                        </Table>
                    </ScrollArea>
                </TabsContent>
            </Tabs>

            <div className="flex justify-between items-center bg-muted/50 p-4 rounded-lg border">
                <div className="flex items-center gap-3">
                    {sortedNew.length + sortedUpdates.length > 0 ? (
                        <div className="p-2 bg-green-100 rounded-full"><CheckCircle className="text-green-600 h-6 w-6" /></div>
                    ) : (
                        <div className="p-2 bg-amber-100 rounded-full"><AlertCircle className="text-amber-600 h-6 w-6" /></div>
                    )}
                    <div>
                        <p className="font-bold">{(sortedNew.length + sortedUpdates.length + sortedDeletions.length) > 0 ? "Synchronization Ready" : "No Changes Found"}</p>
                        <p className="text-xs text-muted-foreground">Contract identified as: {dryRun.profileId}</p>
                    </div>
                </div>
                <div className="flex gap-3">
                    <Button variant="ghost" onClick={() => setDryRun(null)}>Discard</Button>
                    <Button onClick={handleFinalPublish} disabled={isPublishing || (sortedNew.length + sortedUpdates.length + sortedDeletions.length === 0)}>
                        {isPublishing ? <Spinner /> : <><RotateCw className="mr-2 h-4 w-4" /> Publish Changes</>}
                    </Button>
                </div>
            </div>

            <div className="pt-8 mt-8 border-t">
                <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => setShowTechnicalLog(!showTechnicalLog)}
                    className="text-muted-foreground"
                >
                    {showTechnicalLog ? <><EyeOff className="mr-2 h-4 w-4" /> Hide Technical Log</> : <><Eye className="mr-2 h-4 w-4" /> Show Technical Log</>}
                </Button>

                {showTechnicalLog && (
                    <Card className="mt-4">
                        <CardHeader className="py-3 bg-muted/30">
                            <CardTitle className="text-sm flex items-center gap-2 font-mono"><FileSearch className="h-4 w-4" /> Diagnostic Engine Trace</CardTitle>
                        </CardHeader>
                        <CardContent className="p-0">
                            <ScrollArea className="h-[300px]">
                                <div className="p-4 space-y-1">
                                    {technicalLogs.map((log, i) => (
                                        <div key={i} className="text-[10px] font-mono flex gap-4 border-b border-muted py-1">
                                            <span className="text-muted-foreground w-20 shrink-0">[{log.code}]</span>
                                            <span className="text-muted-foreground w-24 shrink-0">{log.sheet}{log.cell ? `/${log.cell}` : ''}</span>
                                            <span>{log.message}</span>
                                        </div>
                                    ))}
                                </div>
                            </ScrollArea>
                        </CardContent>
                    </Card>
                )}
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
            <Button variant="outline" size="sm"><HelpCircle className="mr-2 h-4 w-4" /> Layout Guide</Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl">
            <DialogHeader><DialogTitle>Spreadsheet Formatting Help</DialogTitle></DialogHeader>
            <ScrollArea className="max-h-[70vh] pr-4">
              <div className="space-y-8 py-4">
                <div className="space-y-3">
                    <div className="flex items-center gap-2 font-semibold text-primary"><LayoutGrid className="h-5 w-5" /><h3>Battleship Grid (Gas Department)</h3></div>
                    <ul className="text-sm space-y-2 list-disc pl-5">
                        <li><strong>Property Sections</strong>: Listed vertically in Column A. The system looks for <i>Site Refs (E9000)</i> or <i>Postcodes</i> to identify the job location.</li>
                        <li><strong>Horizontal Dates</strong>: Dates are expected across the top header row (usually Row 4-6).</li>
                        <li><strong>Embedded Names</strong>: Work cells must contain the operative's full name (e.g., "Boiler Service - PHIL SHERGOLD").</li>
                        <li><strong>Shift Types</strong>: Start text with "AM" or "PM" for partial shifts; otherwise, "All Day" is assumed.</li>
                    </ul>
                </div>
              </div>
            </ScrollArea>
          </DialogContent>
        </Dialog>
      </div>

      {!dryRun ? (
        <Card>
          <CardHeader>
            <CardTitle>Upload Planner</CardTitle>
            <CardDescription>Drag and drop your spreadsheet to run a diagnostic test. No database changes will be made until you confirm.</CardDescription>
          </CardHeader>
          <CardContent>
            <FileUploader onImportComplete={handleImportComplete} onFileSelect={() => setDryRun(null)} userProfile={userProfile} />
          </CardContent>
        </Card>
      ) : renderDryRunResults(dryRun)}
    </div>
  );
}
