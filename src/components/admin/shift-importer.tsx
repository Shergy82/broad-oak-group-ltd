
'use client';

import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { FileUploader, type FailedShift, type DryRunResult } from './file-uploader';
import type { UserProfile } from '@/types';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { CheckCircle, FileWarning, Upload, List, ArrowRight, Edit, Plus, Trash2 } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from '../ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { format } from 'date-fns';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAllUsers } from '@/hooks/use-all-users';
import { Label } from '../ui/label';

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
  const [importDepartment, setImportDepartment] = useState(userProfile.department || '');
  const { users: allUsers, loading: usersLoading } = useAllUsers();

  const isOwner = userProfile.role === 'owner';

  const availableDepartments = useMemo(() => {
    if (!isOwner) return [];
    const depts = new Set<string>();
    allUsers.forEach(u => {
        if (u.department) depts.add(u.department);
    });
    return Array.from(depts).sort();
  }, [isOwner, allUsers]);

  useEffect(() => {
    if (isOwner && !importDepartment && availableDepartments.length > 0) {
      setImportDepartment(availableDepartments[0]);
    }
  }, [isOwner, importDepartment, availableDepartments]);

  const handleImportComplete = (
    failedShifts: FailedShift[],
    onConfirm: () => Promise<void>,
    dryRunResult?: DryRunResult
  ) => {
    setImportResults({ failedShifts, onConfirm, dryRunResult });
    setIsConfirmed(false);
  };
  
  const handleFileSelect = () => {
    setImportResults(null);
    setIsConfirmed(false);
  }

  const handleConfirmImport = async () => {
    if (importResults?.onConfirm) {
      await importResults.onConfirm();
      setIsConfirmed(true);
    }
  };

  const renderDryRunResults = (dryRun: DryRunResult) => {
    const hasChanges = dryRun.toCreate.length > 0 || dryRun.toUpdate.length > 0 || dryRun.toDelete.length > 0;
    
    return (
        <Tabs defaultValue="overview">
            <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="create">New ({dryRun.toCreate.length})</TabsTrigger>
                <TabsTrigger value="update">Updates ({dryRun.toUpdate.length})</TabsTrigger>
                <TabsTrigger value="delete">Deletions ({dryRun.toDelete.length})</TabsTrigger>
            </TabsList>
             <TabsContent value="overview">
                <Card>
                    <CardHeader>
                        <CardTitle>Import Summary</CardTitle>
                        <CardDescription>Review the changes that will be made before confirming.</CardDescription>
                    </CardHeader>
                    <CardContent className="grid gap-4 sm:grid-cols-3">
                         <div className="flex items-center space-x-4 rounded-md border p-4">
                            <Plus className="h-8 w-8 text-green-500"/>
                            <div className="flex-1 space-y-1">
                                <p className="text-sm font-medium leading-none">Shifts to Create</p>
                                <p className="text-2xl font-bold">{dryRun.toCreate.length}</p>
                            </div>
                        </div>
                         <div className="flex items-center space-x-4 rounded-md border p-4">
                            <Edit className="h-8 w-8 text-blue-500" />
                            <div className="flex-1 space-y-1">
                                <p className="text-sm font-medium leading-none">Shifts to Update</p>
                                <p className="text-2xl font-bold">{dryRun.toUpdate.length}</p>
                            </div>
                        </div>
                         <div className="flex items-center space-x-4 rounded-md border p-4">
                            <Trash2 className="h-8 w-8 text-red-500" />
                            <div className="flex-1 space-y-1">
                                <p className="text-sm font-medium leading-none">Shifts to Delete</p>
                                <p className="text-2xl font-bold">{dryRun.toDelete.length}</p>
                            </div>
                        </div>
                    </CardContent>
                    <CardFooter>
                        {hasChanges ? (
                             <Button onClick={handleConfirmImport}>Confirm & Publish Changes</Button>
                        ): (
                            <Alert>
                                <CheckCircle className="h-4 w-4" />
                                <AlertTitle>No Changes</AlertTitle>
                                <AlertDescription>The schedule is already up-to-date with the selected file.</AlertDescription>
                            </Alert>
                        )}
                    </CardFooter>
                </Card>
            </TabsContent>
            <TabsContent value="create">
                 <Card>
                    <CardHeader><CardTitle>New Shifts</CardTitle></CardHeader>
                    <CardContent>
                        <ScrollArea className="h-72">
                            <Table>
                                <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>User</TableHead><TableHead>Task</TableHead><TableHead>Address</TableHead></TableRow></TableHeader>
                                <TableBody>
                                  {[...dryRun.toCreate]
                                    .sort((a, b) => a.date.getTime() - b.date.getTime())
                                    .map((s, i) => (
                                      <TableRow key={i}>
                                        <TableCell>{format(s.date, 'PPP')}</TableCell>
                                        <TableCell>{s.userName}</TableCell>
                                        <TableCell>{s.task}</TableCell>
                                        <TableCell>{s.address}</TableCell>
                                      </TableRow>
                                    ))}
                                </TableBody>

                            </Table>
                        </ScrollArea>
                    </CardContent>
                </Card>
            </TabsContent>
            <TabsContent value="update">
                 <Card>
                    <CardHeader><CardTitle>Updated Shifts</CardTitle></CardHeader>
                    <CardContent>
                         <ScrollArea className="h-72">
                            <Table>
                                <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>User</TableHead><TableHead>Task</TableHead><TableHead>Changes</TableHead></TableRow></TableHeader>
                                <TableBody>{dryRun.toUpdate.map((u,i) => <TableRow key={i}><TableCell>{format(u.new.date, 'PPP')}</TableCell><TableCell>{u.new.userName}</TableCell><TableCell>{u.new.task}</TableCell><TableCell className="text-xs">eNumber: {u.old.eNumber} <ArrowRight className="inline"/> {u.new.eNumber}<br/>Manager: {u.old.manager} <ArrowRight className="inline"/> {u.new.manager}</TableCell></TableRow>)}</TableBody>
                            </Table>
                        </ScrollArea>
                    </CardContent>
                </Card>
            </TabsContent>
            <TabsContent value="delete">
                <Card>
                    <CardHeader><CardTitle>Deleted Shifts</CardTitle></CardHeader>
                    <CardContent>
                         <ScrollArea className="h-72">
                            <Table>
                                <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>User</TableHead><TableHead>Task</TableHead><TableHead>Address</TableHead></TableRow></TableHeader>
                                <TableBody>{dryRun.toDelete.map((s,i) => <TableRow key={i}><TableCell>{format(s.date.toDate(), 'PPP')}</TableCell><TableCell>{s.userName}</TableCell><TableCell>{s.task}</TableCell><TableCell>{s.address}</TableCell></TableRow>)}</TableBody>
                            </Table>
                        </ScrollArea>
                    </CardContent>
                </Card>
            </TabsContent>
        </Tabs>
    )
  }
  
  const renderFailedShifts = (failures: FailedShift[]) => (
     <Card>
        <CardHeader>
             <Alert variant="destructive">
                <FileWarning className="h-4 w-4" />
                <AlertTitle>{failures.length} Row(s) Failed to Import</AlertTitle>
                <AlertDescription>These rows could not be processed. Please check the data in the indicated cells and try again.</AlertDescription>
            </Alert>
        </CardHeader>
        <CardContent>
             <ScrollArea className="h-72">
                <Table>
                    <TableHeader><TableRow><TableHead>Sheet</TableHead><TableHead>Cell</TableHead><TableHead>Reason</TableHead></TableRow></TableHeader>
                    <TableBody>
                        {failures.map((f, i) => <TableRow key={i}><TableCell>{f.sheetName}</TableCell><TableCell>{f.cellRef}</TableCell><TableCell>{f.reason}</TableCell></TableRow>)}
                    </TableBody>
                </Table>
             </ScrollArea>
        </CardContent>
    </Card>
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import Shifts from Excel</CardTitle>
        <CardDescription>
          Upload an Excel workbook to create, update, or delete shifts in bulk.
          Use the "Dry Run" option to preview changes before publishing.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isOwner && (
            <div className="space-y-2 mb-4">
                <Label htmlFor="import-format-select">Select Import Format</Label>
                <Select value={importDepartment} onValueChange={setImportDepartment}>
                    <SelectTrigger id="import-format-select">
                        <SelectValue placeholder="Select department's format..." />
                    </SelectTrigger>
                    <SelectContent>
                        {usersLoading 
                            ? <div className="p-2 text-sm text-muted-foreground">Loading departments...</div>
                            : availableDepartments.map(dept => <SelectItem key={dept} value={dept}>{dept} Department Format</SelectItem>)
                        }
                        <SelectItem value="Other">Standard/ECO Format</SelectItem>
                    </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Select 'Build' for the new layout, 'Standard/ECO' for the old one.</p>
            </div>
        )}
        <FileUploader
          onImportComplete={handleImportComplete}
          onFileSelect={handleFileSelect}
          userProfile={userProfile}
          importDepartment={importDepartment}
        />
      </CardContent>

      {importResults && (
        <CardFooter className="flex-col items-start gap-4 pt-6">
          {isConfirmed ? (
             <>
                <Alert>
                    <CheckCircle className="h-4 w-4" />
                    <AlertTitle>Import Successful!</AlertTitle>
                    <AlertDescription>Your changes have been published.</AlertDescription>
                </Alert>
                {importResults.failedShifts.length > 0 && renderFailedShifts(importResults.failedShifts)}
             </>
          ) : (
             <>
                {importResults.dryRunResult && renderDryRunResults(importResults.dryRunResult)}
                {importResults.failedShifts.length > 0 && renderFailedShifts(importResults.failedShifts)}
             </>
          )}
        </CardFooter>
      )}
    </Card>
  );
}
