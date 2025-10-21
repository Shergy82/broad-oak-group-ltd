
'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { FileUploader, FailedShift, ParsedShift } from '@/components/admin/file-uploader';
import { ShiftScheduleOverview } from '@/components/admin/shift-schedule-overview';
import { useUserProfile } from '@/hooks/use-user-profile';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Download, FileWarning, CheckCircle, TestTube2, AlertCircle, Upload, XCircle, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { Alert, AlertTitle, AlertDescription } from '../ui/alert';
import { useAllUsers } from '@/hooks/use-all-users';
import { useToast } from '@/hooks/use-toast';
import { Spinner } from '../shared/spinner';

interface ReconciliationResult {
    toCreate: ParsedShift[];
    toUpdate: { id: string; data: Partial<any> }[];
    toDelete: string[];
    failed: FailedShift[];
}

export default function AdminPageContent() {
  const { userProfile } = useUserProfile();
  const { users: allUsers, loading: usersLoading } = useAllUsers();
  const [importReport, setImportReport] = useState<{ failed: FailedShift[] } | null>(null);
  const [dryRunResult, setDryRunResult] = useState<ReconciliationResult | null>(null);
  const [importAttempted, setImportAttempted] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  
  const isPrivilegedUser = userProfile && ['admin', 'owner'].includes(userProfile.role);
  const { toast } = useToast();

  const userNameMap = useMemo(() => {
    if (usersLoading || !allUsers) return new Map();
    return new Map(allUsers.map(u => [u.uid, u.name]));
  }, [allUsers, usersLoading]);

  const handleImportComplete = (failedShifts: FailedShift[], dryRunData?: ReconciliationResult) => {
    const sortedFailed = failedShifts.sort((a, b) => {
        if (!a.date) return 1;
        if (!b.date) return -1;
        return a.date.getTime() - b.date.getTime();
    });

    if (dryRunData) {
        setDryRunResult(dryRunData);
        setImportReport(null);
    } else {
        setImportReport({ failed: sortedFailed });
        setDryRunResult(null);
    }
    setImportAttempted(true);
    setIsPublishing(false);
  };
  
  const handleFileSelection = () => {
    setImportAttempted(false);
    setImportReport(null);
    setDryRunResult(null);
  };
  
  const handleDownloadPdf = async () => {
    if (!importReport?.failed || importReport.failed.length === 0) return;
    
    const { default: jsPDF } = await import('jspdf');
    const { default: autoTable } = await import('jspdf-autotable');

    const doc = new jsPDF();
    const generationDate = new Date();

    doc.setFontSize(18);
    doc.text(`Failed Shift Import Report`, 14, 22);
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(`Generated on: ${format(generationDate, 'PPP p')}`, 14, 28);
    
    const head = [['Sheet', 'Date', 'Project Address', 'Original Cell Content', 'Reason for Failure']];
    const body = importReport.failed.map(shift => [
        shift.sheetName,
        shift.date ? format(shift.date, 'dd/MM/yyyy') : 'N/A',
        shift.projectAddress,
        shift.cellContent,
        shift.reason
    ]);

    autoTable(doc, {
        head,
        body,
        startY: 35,
        headStyles: { fillColor: [220, 38, 38] }, // Red color for header
    });
    
    doc.save(`failed_shifts_report_${format(generationDate, 'yyyy-MM-dd')}.pdf`);
  };

  const renderDryRunReport = () => {
    if (!dryRunResult) return null;

    const { toCreate = [], toUpdate = [], toDelete = [], failed = [] } = dryRunResult;

    const sortShifts = (shifts: ParsedShift[]) => [...shifts].sort((a, b) => {
      const nameA = userNameMap.get(a.userId) || '';
      const nameB = userNameMap.get(b.userId) || '';
      if (nameA.localeCompare(nameB) !== 0) return nameA.localeCompare(nameB);
      if(!a.date || !b.date) return 0;
      return a.date.getTime() - b.date.getTime();
    });

    return (
        <Card className="mt-6 border-blue-500">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-blue-600">
                    <TestTube2 />
                    Dry Run Results
                </CardTitle>
                <CardDescription>
                    This is a preview of the import. No changes have been saved yet. Review the summary below and click "Confirm and Publish" to apply them.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div>
                    <h3 className="font-semibold flex items-center gap-2 mb-2">
                        <CheckCircle className="text-green-600" /> 
                        {toCreate.length} New Shifts to be Created
                    </h3>
                    {toCreate.length > 0 && (
                        <div className="max-h-60 overflow-y-auto border rounded-lg">
                        <Table>
                            <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Operative</TableHead><TableHead>Task</TableHead><TableHead>Address</TableHead></TableRow></TableHeader>
                            <TableBody>
                                {sortShifts(toCreate).map((shift, index) => (
                                    <TableRow key={index}><TableCell>{shift.date ? format(shift.date, 'dd/MM/yy') : 'N/A'}</TableCell><TableCell>{userNameMap.get(shift.userId) || shift.userId}</TableCell><TableCell>{shift.task}</TableCell><TableCell>{shift.address}</TableCell></TableRow>
                                ))}
                            </TableBody>
                        </Table>
                        </div>
                    )}
                </div>
                 <div>
                    <h3 className="font-semibold flex items-center gap-2 mb-2">
                        <Trash2 className="text-destructive" /> 
                        {toDelete.length} Shifts to be Deleted
                    </h3>
                    {toDelete.length > 0 && <p className="text-sm text-muted-foreground">Shifts no longer in the schedule will be removed.</p>}
                </div>
                <div>
                    <h3 className="font-semibold flex items-center gap-2 mb-2">
                        <AlertCircle className="text-amber-500" /> 
                        {failed.length} Rows Failed to Parse
                    </h3>
                     {failed.length > 0 && (
                        <div className="max-h-60 overflow-y-auto border rounded-lg">
                        <Table>
                           <TableHeader><TableRow><TableHead>Sheet</TableHead><TableHead>Date</TableHead><TableHead>Cell Content</TableHead><TableHead>Reason</TableHead></TableRow></TableHeader>
                            <TableBody>
                                {failed.map((shift, index) => (
                                    <TableRow key={index}><TableCell>{shift.sheetName}</TableCell><TableCell>{shift.date ? format(shift.date, 'dd/MM/yy') : 'N/A'}</TableCell><TableCell className="font-mono text-xs">{shift.cellContent}</TableCell><TableCell>{shift.reason}</TableCell></TableRow>
                                ))}
                            </TableBody>
                        </Table>
                        </div>
                    )}
                </div>
            </CardContent>
             <CardFooter className="flex justify-end gap-2">
                <Button variant="outline" onClick={handleFileSelection} disabled={isPublishing}>
                    <XCircle className="mr-2 h-4 w-4" />
                    Cancel
                </Button>
                <FileUploader 
                    onImportComplete={handleImportComplete}
                    onFileSelect={() => {}}
                    shiftsToPublish={dryRunResult}
                >
                    <Button disabled={isPublishing || (toCreate.length === 0 && toUpdate.length === 0 && toDelete.length === 0)}>
                        {isPublishing ? <Spinner /> : <><Upload className="mr-2 h-4 w-4" />Confirm and Publish</>}
                    </Button>
                </FileUploader>
            </CardFooter>
        </Card>
    );
  }

  return (
    <div className="space-y-8">
      
      {isPrivilegedUser && (
        <Card>
          <CardHeader>
            <CardTitle>Import Weekly Shifts from Excel</CardTitle>
            <CardDescription>
                Upload an Excel workbook. The tool will read shifts from all selected sheets, reconcile them against existing data, and show you a preview of what will be created, updated, or deleted.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FileUploader onImportComplete={handleImportComplete} onFileSelect={handleFileSelection} />
          </CardContent>
        </Card>
      )}

      {importAttempted && dryRunResult && renderDryRunReport()}

      {importAttempted && !dryRunResult && (
          <>
            {(importReport?.failed.length ?? 0) > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <FileWarning className="text-destructive" />
                            Failed Import Report
                        </CardTitle>
                        <CardDescription>
                            The following {importReport!.failed.length} shift(s) could not be imported. Please correct them in the source file and re-upload. All other shifts were processed successfully.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader><TableRow><TableHead>Sheet</TableHead><TableHead>Date</TableHead><TableHead>Project Address</TableHead><TableHead>Original Cell Content</TableHead><TableHead>Reason for Failure</TableHead></TableRow></TableHeader>
                            <TableBody>
                                {importReport!.failed.map((shift, index) => (
                                    <TableRow key={index}><TableCell>{shift.sheetName}</TableCell><TableCell>{shift.date ? format(shift.date, 'dd/MM/yyyy') : 'N/A'}</TableCell><TableCell>{shift.projectAddress}</TableCell><TableCell className="font-mono text-xs">{shift.cellContent}</TableCell><TableCell>{shift.reason}</TableCell></TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                    <CardFooter className="flex justify-end">
                      <Button onClick={handleDownloadPdf}>
                          <Download className="mr-2 h-4 w-4" />
                          Download PDF Report
                      </Button>
                    </CardFooter>
                </Card>
            )}

            {importReport && importReport.failed.length === 0 && (
                <Alert className="border-green-500 text-green-700">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    <AlertTitle>Import Successful</AlertTitle>
                    <AlertDescription>
                        The file was processed successfully, and all shifts were reconciled.
                    </AlertDescription>
                </Alert>
            )}
        </>
      )}
      
      {isPrivilegedUser && userProfile && (
         <ShiftScheduleOverview userProfile={userProfile} />
      )}

    </div>
  );
}

    
