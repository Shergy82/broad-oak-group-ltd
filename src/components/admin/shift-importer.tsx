'use client';

import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { FileUploader, type FailedShift, type DryRunResult, type ParsedShift } from './file-uploader';
import type { UserProfile, Shift } from '@/types';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { CheckCircle, FileWarning, Upload, List, ArrowRight, Edit, Plus, Trash2, Download, FileText } from 'lucide-react';
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
      const storedType = localStorage.getItem(LS_IMPORT_TYPE_KEY);
      if (storedType === 'BUILD' || storedType === 'GAS') {
        setImportType(storedType);
      }
    } catch (e) {
      // Ignore localStorage errors
    }
  }, []);

  const handleImportTypeChange = (value: ImportType) => {
    setImportType(value);
    try {
        localStorage.setItem(LS_IMPORT_TYPE_KEY, value);
    } catch (e) {
        console.error("Failed to save import type preference:", e);
    }
  };

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

  const handleDownloadFailedReport = async (failedShifts: FailedShift[]) => {
    if (failedShifts.length === 0) return;

    const { default: jsPDF } = await import('jspdf');
    const { default: autoTable } = await import('jspdf-autotable');

    const doc = new jsPDF();
    const generationDate = new Date();

    doc.setFontSize(18);
    doc.text('Failed Shift Import Report', 14, 22);
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(`Generated on: ${format(generationDate, 'PPP p')}`, 14, 28);
    doc.text(`Department: ${importType === 'GAS' ? 'Gas' : importDepartment}`, 14, 34);

    const head = [['Sheet', 'Cell', 'Content', 'Reason for Failure']];
    const body = failedShifts.map(f => [
        f.sheetName,
        f.cellRef,
        f.cellContent,
        f.reason,
    ]);

    autoTable(doc, {
        startY: 40,
        head,
        body,
        headStyles: { fillColor: [220, 53, 69] },
        columnStyles: {
            2: { cellWidth: 50 },
            3: { cellWidth: 'auto' },
        },
        styles: {
            fontSize: 9,
        }
    });

    doc.save(`failed_shift_import_${format(generationDate, 'yyyy-MM-dd')}.pdf`);
  };

  const handleConfirmImport = async () => {
    if (importResults?.onConfirm) {
      await importResults.onConfirm();
      setIsConfirmed(true);
      
      // If there are failures, trigger the post-import dialog
      if (importResults.failedShifts.length > 0) {
        setIsPostImportDialogOpen(true);
      }
    }
  };
  
  /**
   * 🔒 ROBUST DATE FORMATTING
   */
  const safeFormatDate = (date: any) => {
    if (!date) return 'N/A';
    try {
      const d = date instanceof Date ? date : (date?.toDate ? date.toDate() : new Date(date));
      if (!isValid(d)) return 'Invalid Date';
      return format(d, 'PPP');
    } catch (e) {
      console.error("safeFormatDate error:", e);
      return 'Invalid Date';
    }
  }

  const renderDryRunResults = (dryRun: DryRunResult) => {
    const hasChanges = dryRun.toCreate.length > 0 || dryRun.toUpdate.length > 0 || dryRun.toDelete.length > 0;
    const hasFailures = dryRun.failed.length > 0;
    
    let defaultTab = "overview";
    if (!hasChanges && hasFailures) {
        defaultTab = "failed";
    }

    const renderChanges = (oldShift: Shift, newShift: ParsedShift) => {
        const changes: React.ReactNode[] = [];
        const fieldsToCompare: { key: keyof Shift | keyof ParsedShift, label: string }[] = [
            { key: 'task', label: 'Task' },
            { key: 'type', label: 'Type' },
            { key: 'eNumber', label: 'Number' },
            { key: 'manager', label: 'Manager' },
            { key: 'contract', label: 'Contract' },
            { key: 'department', label: 'Department' },
            { key: 'notes', label: 'Notes' },
        ];

        fieldsToCompare.forEach(field => {
            const oldValue = (oldShift as any)[field.key] || '';
            const newValue = (newShift as any)[field.key] || '';
            
            if (oldValue !== newValue) {
                changes.push(
                    <div key={field.key} className="flex items-start gap-1">
                        <span className="font-semibold">{field.label}:</span>
                        <div className="flex flex-col text-left">
                            <span className="text-red-600 line-through">{oldValue || 'N/A'}</span>
                            <div className="flex items-center">
                                <ArrowRight className="inline h-3 w-3 mr-1" />
                                <span className="text-green-600">{newValue || 'N/A'}</span>
                            </div>
                        </div>
                    </div>
                );
            }
        });

        if (changes.length === 0) {
            return <span className="text-muted-foreground italic">No significant changes detected.</span>
        }

        return <div className="space-y-1">{changes}</div>;
    };
    
    return (
        <Tabs defaultValue={defaultTab}>
            <TabsList className="grid w-full grid-cols-5">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="create">New ({dryRun.toCreate.length})</TabsTrigger>
                <TabsTrigger value="update">Updates ({dryRun.toUpdate.length})</TabsTrigger>
                <TabsTrigger value="delete">Deletions ({dryRun.toDelete.length})</TabsTrigger>
                <TabsTrigger value="failed" className="data-[state=active]:text-destructive data-[state=active]:border-destructive">Failed ({dryRun.failed.length})</TabsTrigger>
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
                                <AlertTitle>No Changes Needed</AlertTitle>
                                <AlertDescription>The schedule is already up-to-date with the selected file. {hasFailures && "However, there were some rows that could not be processed."}</AlertDescription>
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
                                    .map((s, i) => (
                                      <TableRow key={i}>
                                        <TableCell>{safeFormatDate(s.date)}</TableCell>
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
                    <CardHeader><CardTitle>Updated Shifts</CardTitle><CardDescription>Only shifts with meaningful changes are shown here.</CardDescription></CardHeader>
                    <CardContent>
                         <ScrollArea className="h-72">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Date</TableHead>
                                        <TableHead>User</TableHead>
                                        <TableHead>Changes</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {[...dryRun.toUpdate]
                                      .map((u,i) => (
                                        <TableRow key={i}>
                                            <TableCell>{safeFormatDate(u.new.date)}</TableCell>
                                            <TableCell>{u.new.userName}</TableCell>
                                            <TableCell className="text-xs">{renderChanges(u.old, u.new)}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
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
                                <TableBody>
                                  {[...dryRun.toDelete]
                                    .map((s,i) => (
                                      <TableRow key={i}>
                                        <TableCell>{safeFormatDate(s.date)}</TableCell>
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
            <TabsContent value="failed">
                 <Card>
                    <CardHeader>
                       <div className="flex justify-between items-center gap-4">
                            <Alert variant="destructive" className="flex-grow">
                                <FileWarning className="h-4 w-4" />
                                <AlertTitle>{dryRun.failed.length} Row(s) Failed to Import</AlertTitle>
                                <AlertDescription>These rows could not be processed. Please check the data in the indicated cells and try again.</AlertDescription>
                            </Alert>
                            {dryRun.failed.length > 0 && (
                                <Button onClick={() => handleDownloadFailedReport(dryRun.failed)} variant="outline" size="sm" className="ml-4 shrink-0">
                                    <Download className="mr-2 h-4 w-4" />
                                    PDF Report
                                </Button>
                            )}
                        </div>
                    </CardHeader>
                    <CardContent>
                         <ScrollArea className="h-72">
                            <Table>
                                <TableHeader><TableRow><TableHead>Sheet</TableHead><TableHead>Cell</TableHead><TableHead>Content</TableHead><TableHead>Reason</TableHead></TableRow></TableHeader>
                                <TableBody>
                                    {dryRun.failed.map((f, i) => <TableRow key={i}>
                                        <TableCell>{f.sheetName}</TableCell>
                                        <TableCell>{f.cellRef}</TableCell>
                                        <TableCell><span className="text-xs font-mono bg-muted p-1 rounded">{f.cellContent}</span></TableCell>
                                        <TableCell>{f.reason}</TableCell>
                                      </TableRow>)}
                                </TableBody>
                            </Table>
                         </ScrollArea>
                    </CardContent>
                </Card>
            </TabsContent>
        </Tabs>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Import Shifts from Excel</CardTitle>
          <CardDescription>
            Upload an Excel workbook to create, update, or delete shifts in bulk.
            Use the "Dry Run" option to preview changes before publishing.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
              <div className="space-y-2">
                  <Label htmlFor="import-format-select">Select Import Format</Label>
                  <Select value={importType} onValueChange={(v) => handleImportTypeChange(v as 'BUILD' | 'GAS')}>
                      <SelectTrigger id="import-format-select">
                          <SelectValue placeholder="Select import format..." />
                      </SelectTrigger>
                      <SelectContent>
                          <SelectItem value="BUILD">Build Department Format</SelectItem>
                          <SelectItem value="GAS">Gas Department Format</SelectItem>
                      </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Select the format that matches your Excel file.</p>
              </div>
              
              {importType === 'GAS' ? (
                  <div className="space-y-2">
                      <Label>Department</Label>
                      <Input value="Gas" disabled />
                      <p className="text-xs text-muted-foreground">GAS format files are always imported into the Gas department.</p>
                  </div>
              ) : isOwner ? (
                  <div className="space-y-2">
                      <Label htmlFor="import-department-select">Assign to Department</Label>
                      <Select value={importDepartment} onValueChange={setImportDepartment}>
                          <SelectTrigger id="import-department-select">
                              <SelectValue placeholder="Select department..." />
                          </SelectTrigger>
                          <SelectContent>
                              {usersLoading 
                                  ? <div className="p-2 text-sm text-muted-foreground">Loading departments...</div>
                                  : availableDepartments.map(dept => <SelectItem key={dept} value={dept}>{dept}</SelectItem>)
                              }
                          </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">All imported shifts will be tagged with this department.</p>
                  </div>
              ) : (
                   <div className="space-y-2">
                      <Label>Department</Label>
                      <Input value={userProfile.department || 'No department assigned'} disabled />
                      <p className="text-xs text-muted-foreground">Shifts will be imported into your assigned department.</p>
                  </div>
              )}
          </div>
          <div className="mt-4">
              <FileUploader
              onImportComplete={handleImportComplete}
              onFileSelect={handleFileSelect}
              userProfile={userProfile}
              importDepartment={importDepartment}
              importType={importType}
              />
          </div>
        </CardContent>

        {importResults && (
          <CardFooter className="flex-col items-start gap-4 pt-6">
            {isConfirmed ? (
              <Alert>
                <CheckCircle className="h-4 w-4" />
                <AlertTitle>Import Successful!</AlertTitle>
                <AlertDescription>Your changes have been published.</AlertDescription>
              </Alert>
            ) : (
               importResults.dryRunResult && renderDryRunResults(importResults.dryRunResult)
            )}
          </CardFooter>
        )}
      </Card>

      <Dialog open={isPostImportDialogOpen} onOpenChange={setIsPostImportDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileWarning className="h-5 w-5 text-amber-500" />
              Import Complete with Failures
            </DialogTitle>
            <DialogDescription>
              The import finished, but <strong>{importResults?.failedShifts.length}</strong> row(s) could not be processed due to errors (e.g., misspelled names or invalid formatting).
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4 bg-muted/30 rounded-lg p-4 text-sm space-y-2">
            <p>Would you like to download a PDF report of these failures? This will help you identify which rows need manual correction in your spreadsheet.</p>
          </div>

          <DialogFooter className="flex flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setIsPostImportDialogOpen(false)} className="w-full sm:w-auto">
              Close
            </Button>
            <Button 
              onClick={() => {
                if (importResults) handleDownloadFailedReport(importResults.failedShifts);
                setIsPostImportDialogOpen(false);
              }} 
              className="w-full sm:w-auto"
            >
              <Download className="mr-2 h-4 w-4" />
              Download Failure Report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
