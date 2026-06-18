'use client';

import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { FileUploader, type FailedShift, type DryRunResult } from './file-uploader';
import type { UserProfile } from '@/types';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { CheckCircle, HelpCircle, AlertCircle } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from '../ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { format, isValid } from 'date-fns';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ImportType } from '@/lib/exceljs-parser';

interface ShiftImporterProps {
  userProfile: UserProfile;
}

export function ShiftImporter({ userProfile }: ShiftImporterProps) {
  const [importResults, setImportResults] = useState<{
    failedShifts: FailedShift[];
    onConfirm: () => Promise<void>;
    dryRunResult?: DryRunResult;
  } | null>(null);

  const [isConfirmed, setIsConfirmed] = useState(false);
  const [importDepartment, setImportDepartment] = useState(userProfile.department || 'Gas');
  const [importType, setImportType] = useState<ImportType>('GAS');
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);

  useEffect(() => {
    if (!db) return;
    getDocs(collection(db, 'users')).then(snap => {
      setAllUsers(snap.docs.map(d => ({ uid: d.id, ...d.data() } as UserProfile)));
    });
  }, []);

  const userNameMap = useMemo(() => new Map(allUsers.map(u => [u.uid, u.name])), [allUsers]);

  const handleImportComplete = (failedShifts: FailedShift[], onConfirm: () => Promise<void>, dryRunResult?: DryRunResult) => {
    setImportResults({ failedShifts, onConfirm, dryRunResult });
    setIsConfirmed(false);
  };
  
  const handleConfirmImport = async () => {
    if (importResults?.onConfirm) {
      await importResults.onConfirm();
      setIsConfirmed(true);
    }
  };

  const safeFormatDate = (date: any) => {
    if (!date) return 'N/A';
    try {
      const d = date instanceof Date ? date : (date?.toDate ? date.toDate() : new Date(date));
      return isValid(d) ? format(d, 'EEE, dd MMM') : 'Invalid Date';
    } catch { return 'Invalid Date'; }
  }

  const renderDryRunResults = (dryRun: DryRunResult) => {
    if (!dryRun) return null;

    const hasChanges = (dryRun.toCreate?.length || 0) > 0 || (dryRun.toUpdate?.length || 0) > 0 || (dryRun.toDelete?.length || 0) > 0;
    
    /**
     * 🔒 CHRONOLOGICAL SORTING
     */
    const dateSort = (a: any, b: any) => {
      const getT = (i: any) => {
        const item = i.new || i; // Handle update wrapper
        const d = item.date instanceof Date ? item.date : (item.date?.toDate ? item.date.toDate() : new Date(item.date));
        return (d && !isNaN(d.getTime())) ? d.getTime() : Infinity;
      };
      return getT(a) - getT(b);
    };

    const sortedCreate = [...(dryRun.toCreate || [])].sort(dateSort);
    const sortedUpdate = [...(dryRun.toUpdate || [])].sort((a,b) => dateSort(a, b));
    const sortedDelete = [...(dryRun.toDelete || [])].sort(dateSort);
    const sortedFailed = [...(dryRun.failed || [])].sort((a, b) => {
        if (!a.date || !b.date) return 0;
        return new Date(a.date).getTime() - new Date(b.date).getTime();
    });
    const diagnostics = dryRun.diagnostics || [];

    return (
      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="create">New ({sortedCreate.length})</TabsTrigger>
          <TabsTrigger value="update">Updates ({sortedUpdate.length})</TabsTrigger>
          <TabsTrigger value="delete">Deletions ({sortedDelete.length})</TabsTrigger>
          <TabsTrigger value="failed" className="data-[state=active]:text-destructive">Failed ({sortedFailed.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <Card>
            <CardContent className="grid gap-4 sm:grid-cols-3 pt-6">
              <div className="border p-4 rounded-md bg-green-50/50"><p className="text-xs font-bold uppercase text-green-700">New</p><p className="text-2xl font-bold">{sortedCreate.length}</p></div>
              <div className="border p-4 rounded-md bg-blue-50/50"><p className="text-xs font-bold uppercase text-blue-700">Updates</p><p className="text-2xl font-bold">{sortedUpdate.length}</p></div>
              <div className="border p-4 rounded-md bg-red-50/50"><p className="text-xs font-bold uppercase text-red-700">Deletions</p><p className="text-2xl font-bold">{sortedDelete.length}</p></div>
            </CardContent>
            <CardFooter>
              {hasChanges ? (
                  <Button onClick={handleConfirmImport} className="w-full">Publish All Changes</Button>
              ) : (
                  <Alert className="bg-muted/50 w-full"><CheckCircle className="h-4 w-4" /><AlertTitle>System is synchronized</AlertTitle><AlertDescription>No changes detected in this file.</AlertDescription></Alert>
              )}
            </CardFooter>
          </Card>
        </TabsContent>
        <TabsContent value="create">
          <ScrollArea className="h-80 border rounded-md">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Address</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedCreate.map((s, i) => (
                  <TableRow key={i}>
                    <TableCell>{safeFormatDate(s.date)}</TableCell>
                    <TableCell className="font-semibold">{s.userName}</TableCell>
                    <TableCell className="text-xs">{s.address}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </TabsContent>
        <TabsContent value="update">
          <ScrollArea className="h-80 border rounded-md">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Changes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedUpdate.map((u, i) => (
                  <TableRow key={i}>
                    <TableCell>{safeFormatDate(u.new.date)}</TableCell>
                    <TableCell className="font-semibold">{u.new.userName}</TableCell>
                    <TableCell className="text-xs">
                      <p className="line-through text-muted-foreground">{u.old.task}</p>
                      <p className="font-bold text-blue-600">{u.new.task}</p>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </TabsContent>
        <TabsContent value="delete">
          <ScrollArea className="h-80 border rounded-md">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Address</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedDelete.map((s, i) => (
                  <TableRow key={i}>
                    <TableCell>{safeFormatDate(s.date)}</TableCell>
                    <TableCell>{userNameMap.get(s.userId) || s.userName || 'Unknown'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{s.address}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </TabsContent>
        <TabsContent value="failed">
          <div className="space-y-4">
             <Card className="border-destructive"><CardHeader className="bg-destructive/5"><CardTitle className="text-destructive flex items-center gap-2"><HelpCircle className="h-5 w-5" />Data Quality Instructions</CardTitle></CardHeader><CardContent className="pt-4 text-sm space-y-2"><p><strong>1. Date Boundary:</strong> Dates must strictly start from Column F onwards. The system ignores metadata in the first 5 columns.</p><p><strong>2. Contact Numbers:</strong> Ensure no phone numbers or IDs are in the header rows (Row 4 or 5) from Column F onwards.</p></CardContent></Card>
             {diagnostics.length > 0 && (
                <div className="space-y-2">
                    <h4 className="text-xs font-bold uppercase text-amber-700 flex items-center gap-1"><AlertCircle className="h-3 w-3" /> Fix these specific cells in your Excel file</h4>
                    <div className="border rounded-md"><Table><TableHeader><TableRow><TableHead>Cell</TableHead>UserMapEntry<TableHead>Value</TableHead><TableHead>Issue</TableHead></TableRow></TableHeader><TableBody>{diagnostics.slice(0, 10).map((d, i) => (<TableRow key={i} className="bg-amber-50/30"><TableCell className="font-mono font-bold">{d.cellRef}</TableCell><TableCell className="text-xs truncate max-w-[100px]">{d.value}</TableCell><TableCell className="text-xs text-destructive">{d.reason}</TableCell></TableRow>))}</TableBody></Table></div>
                </div>
             )}
             <ScrollArea className="h-64 border rounded-md"><Table><TableHeader className="sticky top-0 bg-background"><TableRow><TableHead>Cell</TableHead><TableHead>Reason</TableHead><TableHead>Content</TableHead></TableRow></TableHeader><TableBody>{sortedFailed.map((f, i) => (
               <TableRow key={i}>
                 <TableCell className="font-mono">{f.cellRef}</TableCell>
                 <TableCell className="text-destructive font-medium">{f.reason}</TableCell>
                 <TableCell className="text-xs opacity-50">{f.cellContent}</TableCell>
               </TableRow>
             ))}</TableBody></Table></ScrollArea>
          </div>
        </TabsContent>
      </Tabs>
    );
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Schedule Import Hub</CardTitle><CardDescription>Sync Gas or Build planners with the application database.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2"><Label>Planner Type</Label><Select value={importType} onValueChange={(v: any) => setImportType(v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="GAS">Gas Department</SelectItem><SelectItem value="BUILD">Build Department</SelectItem></SelectContent></Select></div>
            {importType === 'BUILD' && <div className="space-y-2"><Label>Department</Label><Input value={importDepartment} disabled /></div>}
          </div>
          <FileUploader onImportComplete={handleImportComplete} onFileSelect={() => {setImportResults(null); setIsConfirmed(false);}} userProfile={userProfile} importDepartment={importDepartment} importType={importType} />
        </CardContent>
        {importResults && (<CardFooter className="pt-6 border-t flex flex-col">{isConfirmed ? <Alert className="bg-green-50 border-green-500 w-full"><CheckCircle className="h-4 w-4 text-green-600" /><AlertTitle>Success</AlertTitle><AlertDescription>Shifts have been synchronized with the database.</AlertDescription></Alert> : renderDryRunResults(importResults.dryRunResult!)}</CardFooter>)}
      </Card>
    </div>
  );
}
