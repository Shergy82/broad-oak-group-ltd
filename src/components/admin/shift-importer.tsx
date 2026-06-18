'use client';

import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { FileUploader, type FailedShift, type DryRunResult, type ParsedShift } from './file-uploader';
import type { UserProfile, Shift } from '@/types';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { CheckCircle, FileWarning, ArrowRight, Edit, Plus, Trash2, Download, AlertCircle, HelpCircle } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from '../ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { format, isValid } from 'date-fns';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAllUsers } from '@/hooks/use-all-users';
import { Label } from '../ui/label';
import type { ImportType } from '@/lib/exceljs-parser';
import { Input } from '../ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface ShiftImporterProps {
  userProfile: UserProfile;
}

const LS_IMPORT_TYPE_KEY = 'shiftImport_importType_v1';

export function ShiftImporter({ userProfile }: ShiftImporterProps) {
  const [importResults, setImportResults] = useState<{
    failedShifts: FailedShift[];
    onConfirm: () => Promise<void>;
    dryRunResult?: DryRunResult;
  } | null>(null);

  const [isConfirmed, setIsConfirmed] = useState(false);
  const [isPostImportDialogOpen, setIsPostImportDialogOpen] = useState(false);
  const [importDepartment, setImportDepartment] = useState(userProfile.department || '');
  const [importType, setImportType] = useState<ImportType>('BUILD');
  const { users: allUsers, loading: usersLoading } = useAllUsers();

  const isOwner = userProfile.role === 'owner';

  useEffect(() => {
    try {
      const stored = localStorage.getItem(LS_IMPORT_TYPE_KEY);
      if (stored === 'BUILD' || stored === 'GAS') setImportType(stored);
    } catch (e) {}
  }, []);

  const availableDepartments = useMemo(() => {
    if (!isOwner || usersLoading) return [];
    return Array.from(new Set(allUsers.map(u => u.department).filter(Boolean))).sort() as string[];
  }, [isOwner, allUsers, usersLoading]);

  useEffect(() => {
    if (isOwner && !importDepartment && availableDepartments.length > 0) {
      setImportDepartment(availableDepartments[0]);
    }
  }, [isOwner, importDepartment, availableDepartments]);

  const handleImportComplete = (failedShifts: FailedShift[], onConfirm: () => Promise<void>, dryRunResult?: DryRunResult) => {
    setImportResults({ failedShifts, onConfirm, dryRunResult });
    setIsConfirmed(false);
  };
  
  const handleConfirmImport = async () => {
    if (importResults?.onConfirm) {
      await importResults.onConfirm();
      setIsConfirmed(true);
      if (importResults.failedShifts.length > 0) setIsPostImportDialogOpen(true);
    }
  };

  const safeFormatDate = (date: any) => {
    if (!date) return 'N/A';
    try {
      const d = date instanceof Date ? date : (date?.toDate ? date.toDate() : new Date(date));
      return isValid(d) ? format(d, 'PPP') : 'Invalid Date';
    } catch (e) { return 'Invalid Date'; }
  }

  const renderDryRunResults = (dryRun: DryRunResult) => {
    const hasChanges = dryRun.toCreate.length > 0 || dryRun.toUpdate.length > 0 || dryRun.toDelete.length > 0;
    const dateSort = (a: any, b: any) => {
      const getT = (i: any) => {
        const d = i.date instanceof Date ? i.date : (i.date?.toDate ? i.date.toDate() : new Date(i.date));
        return (d && !isNaN(d.getTime())) ? d.getTime() : Infinity;
      };
      return getT(a) - getT(b);
    };

    const sortedCreate = [...dryRun.toCreate].sort(dateSort);
    const sortedUpdate = [...dryRun.toUpdate].sort((a,b) => dateSort(a.new, b.new));
    const sortedDelete = [...dryRun.toDelete].sort(dateSort);
    const sortedFailed = [...dryRun.failed].sort(dateSort);
    const diagnostics = dryRun.diagnostics || [];

    return (
      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="create">New ({dryRun.toCreate.length})</TabsTrigger>
          <TabsTrigger value="update">Updates ({dryRun.toUpdate.length})</TabsTrigger>
          <TabsTrigger value="delete">Deletions ({dryRun.toDelete.length})</TabsTrigger>
          <TabsTrigger value="failed" className="data-[state=active]:text-destructive">Failed ({dryRun.failed.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <Card>
            <CardContent className="grid gap-4 sm:grid-cols-3 pt-6">
              <div className="border p-4 rounded-md">
                <p className="text-sm font-medium">New</p>
                <p className="text-2xl font-bold">{dryRun.toCreate.length}</p>
              </div>
              <div className="border p-4 rounded-md">
                <p className="text-sm font-medium">Updates</p>
                <p className="text-2xl font-bold">{dryRun.toUpdate.length}</p>
              </div>
              <div className="border p-4 rounded-md">
                <p className="text-sm font-medium">Deletions</p>
                <p className="text-2xl font-bold">{dryRun.toDelete.length}</p>
              </div>
            </CardContent>
            <CardFooter>
              {hasChanges ? <Button onClick={handleConfirmImport}>Confirm & Publish Changes</Button> : <Alert><CheckCircle className="h-4 w-4" /><AlertTitle>Already up to date</AlertTitle></Alert>}
            </CardFooter>
          </Card>
        </TabsContent>
        <TabsContent value="create">
          <ScrollArea className="h-96 border rounded-md"><Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>User</TableHead><TableHead>Address</TableHead></TableRow></TableHeader><TableBody>{sortedCreate.map((s, i) => (<TableRow key={i}><TableCell>{safeFormatDate(s.date)}</TableCell><TableCell>{s.userName}</TableCell><TableCell>{s.address}</TableCell></TableRow>))}</TableBody></Table></ScrollArea>
        </TabsContent>
        <TabsContent value="update">
          <ScrollArea className="h-96 border rounded-md"><Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>User</TableHead><TableHead>Address</TableHead></TableRow></TableHeader><TableBody>{sortedUpdate.map((u, i) => (<TableRow key={i}><TableCell>{safeFormatDate(u.new.date)}</TableCell><TableCell>{u.new.userName}</TableCell><TableCell>{u.new.address}</TableCell></TableRow>))}</TableBody></Table></ScrollArea>
        </TabsContent>
        <TabsContent value="delete">
          <ScrollArea className="h-96 border rounded-md"><Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>User</TableHead><TableHead>Address</TableHead></TableRow></TableHeader><TableBody>{sortedDelete.map((s, i) => (<TableRow key={i}><TableCell>{safeFormatDate(s.date)}</TableCell><TableCell>{s.userName}</TableCell><TableCell>{s.address}</TableCell></TableRow>))}</TableBody></Table></ScrollArea>
        </TabsContent>
        <TabsContent value="failed">
          <div className="space-y-4">
             <Card className="border-destructive"><CardHeader className="bg-destructive/5"><CardTitle className="text-destructive flex items-center gap-2"><HelpCircle className="h-5 w-5" />Data Fixing Guide</CardTitle></CardHeader><CardContent className="pt-4 text-sm"><p>Ensure Column F onwards strictly contains dates. Remove any phone numbers or long IDs from row 4 or 5.</p></CardContent></Card>
             {diagnostics.length > 0 && (<Card className="border-amber-500"><CardHeader className="bg-amber-500/5"><CardTitle className="text-amber-700 text-sm">Diagnostic: Ignored Cells (Contact Numbers)</CardTitle></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Cell</TableHead><TableHead>Content</TableHead></TableRow></TableHeader><TableBody>{diagnostics.slice(0, 5).map((d, i) => (<TableRow key={i}><TableCell className="font-mono">{d.cellRef}</TableCell><TableCell className="text-xs truncate">{d.value}</TableCell></TableRow>))}</TableBody></Table></CardContent></Card>)}
             <ScrollArea className="h-64 border rounded-md"><Table><TableHeader><TableRow><TableHead>Cell</TableHead><TableHead>Reason</TableHead></TableRow></TableHeader><TableBody>{sortedFailed.map((f, i) => (<TableRow key={i}><TableCell className="font-mono">{f.cellRef}</TableCell><TableCell className="text-destructive">{f.reason}</TableCell></TableRow>))}</TableBody></Table></ScrollArea>
          </div>
        </TabsContent>
      </Tabs>
    );
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Import Shifts from Excel</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Import Format</Label>
            <Select value={importType} onValueChange={(v: any) => setImportType(v)}>
              <SelectTrigger><SelectValue placeholder="Format..." /></SelectTrigger>
              <SelectContent><SelectItem value="BUILD">Build Format</SelectItem><SelectItem value="GAS">Gas Format</SelectItem></SelectContent>
            </Select>
          </div>
          {isOwner && importType === 'BUILD' && (
            <div className="space-y-2">
              <Label>Department</Label>
              <Select value={importDepartment} onValueChange={setImportDepartment}><SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger><SelectContent>{availableDepartments.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent></Select>
            </div>
          )}
          <div className="mt-4">
            <FileUploader onImportComplete={handleImportComplete} onFileSelect={() => {setImportResults(null); setIsConfirmed(false);}} userProfile={userProfile} importDepartment={importDepartment} importType={importType} />
          </div>
        </CardContent>
        {importResults && (<CardFooter className="pt-6 border-t">{isConfirmed ? <Alert className="bg-green-50"><CheckCircle className="h-4 w-4 text-green-600" /><AlertTitle>Success</AlertTitle></Alert> : renderDryRunResults(importResults.dryRunResult!)}</CardFooter>)}
      </Card>
    </div>
  );
}
