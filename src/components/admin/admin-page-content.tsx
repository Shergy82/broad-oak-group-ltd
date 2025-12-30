
'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { FileUploader, FailedShift, DryRunResult } from '@/components/admin/file-uploader';
import { ShiftScheduleOverview } from '@/components/admin/shift-schedule-overview';
import { useUserProfile } from '@/hooks/use-user-profile';
import { useAllUsers } from '@/hooks/use-all-users';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Download, FileWarning, CheckCircle, TestTube2, AlertCircle, PlusCircle, Pencil, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { Alert, AlertTitle, AlertDescription } from '../ui/alert';
import type { UserProfile } from '@/types';
import { Spinner } from '../shared/spinner';


export default function AdminPageContent() {
  const { userProfile } = useUserProfile();
  const [importReport, setImportReport] = useState<{ failed: FailedShift[], dryRun?: DryRunResult } | null>(null);
  const [importAttempted, setImportAttempted] = useState(false);
  const isPrivilegedUser = userProfile && ['admin', 'owner'].includes(userProfile.role);
  const { users: allUsers } = useAllUsers();
  const [userNameMap, setUserNameMap] = useState<Map<string, string>>(new Map());
  
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmImport, setConfirmImport] = useState<(() => Promise<void>) | null>(null);

  useEffect(() => {
    if (allUsers.length > 0) {
      const newMap = new Map<string, string>();
      allUsers.forEach(user => {
        newMap.set(user.uid, user.name);
      });
      setUserNameMap(newMap);
    }
  }, [allUsers]);

  const handleImportComplete = (failedShifts: FailedShift[], onConfirm: () => Promise<void>, dryRunResult?: DryRunResult) => {
    const sortedFailed = failedShifts.sort((a, b) => {
        if (!a.date) return 1;
        if (!b.date) return -1;
        return a.date.getTime() - b.date.getTime();
    });
    setImportReport({ failed: sortedFailed, dryRun: dryRunResult });
    setImportAttempted(true);
    if (dryRunResult) {
        setConfirmImport(() => onConfirm);
    }
  };
  
  const handleFileSelection = () => {
    setImportAttempted(false);
    setImportReport(null);
    setConfirmImport(null);
    setIsConfirming(false);
  };
  
  const handleConfirmAndPublish = async () => {
    if (confirmImport) {
        setIsConfirming(true);
        await confirmImport();
        setIsConfirming(false);
        handleFileSelection(); // Reset the view after import
    }
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
    
    const head = [['Sheet', 'Cell', 'Date', 'Project Address', 'Original Cell Content', 'Reason for Failure']];
    const body = importReport.failed.map(shift => [
        shift.sheetName,
        shift.cellRef,
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
    if (!importReport?.dryRun) return null;

    const { toCreate, toUpdate, toDelete, failed } = importReport.dryRun;

    const sortedCreate = [...toCreate].sort((a, b) => (userNameMap.get(a.userId) || a.userId).localeCompare(userNameMap.get(b.userId) || b.userId) || new Date(a.date).getTime() - new Date(b.date).getTime());
    const sortedUpdate = [...toUpdate].sort((a, b) => (userNameMap.get(a.new.userId) || a.new.userId).localeCompare(userNameMap.get(b.new.userId) || b.new.userId) || new Date(a.new.date).getTime() - new Date(b.new.date).getTime());
    const sortedDelete = [...toDelete].sort((a, b) => (userNameMap.get(a.userId) || a.userId).localeCompare(userNameMap.get(b.userId) || b.userId) || a.date.toDate().getTime() - b.date.toDate().getTime());

    return (
        <Card className="mt-6 border-blue-500">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-blue-600">
                    <TestTube2 />
                    Dry Run Results
                </CardTitle>
                <CardDescription>
                    This is a preview of the changes to be made. No shifts have been created, updated, or deleted. Review the changes below and then click "Confirm & Publish" to apply them.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div>
                    <h3 className="font-semibold flex items-center gap-2 mb-2">
                        <PlusCircle className="text-green-600" /> 
                        {toCreate.length} New Shifts to be Created
                    </h3>
                    {toCreate.length > 0 && (
                        <div className="max-h-60 overflow-y-auto border rounded-lg">
                        <Table>
                            <TableHeader><TableRow><TableHead>Operative</TableHead><TableHead>Date</TableHead><TableHead>Task</TableHead><TableHead>Address</TableHead></TableRow></TableHeader>
                            <TableBody>
                                {sortedCreate.map((shift, index) => (
                                    <TableRow key={index}><TableCell>{userNameMap.get(shift.userId) || shift.userId}</TableCell><TableCell>{format(shift.date, 'dd/MM/yy')}</TableCell><TableCell>{shift.task}</TableCell><TableCell>{shift.address}</TableCell></TableRow>
                                ))}
                            </TableBody>
                        </Table>
                        </div>
                    )}
                </div>

                 <div>
                    <h3 className="font-semibold flex items-center gap-2 mb-2">
                        <Pencil className="text-amber-600" /> 
                        {toUpdate.length} Shifts to be Updated
                    </h3>
                    {toUpdate.length > 0 && (
                        <div className="max-h-60 overflow-y-auto border rounded-lg">
                        <Table>
                            <TableHeader><TableRow><TableHead>Operative</TableHead><TableHead>Date</TableHead><TableHead>Task</TableHead><TableHead>Changes</TableHead></TableRow></TableHeader>
                            <TableBody>
                                {sortedUpdate.map(({old, new: newShift}, index) => (
                                    <TableRow key={index}><TableCell>{userNameMap.get(newShift.userId) || newShift.userId}</TableCell><TableCell>{format(newShift.date, 'dd/MM/yy')}</TableCell><TableCell>{newShift.task}</TableCell><TableCell className="text-xs">Manager: {old.manager} -&gt; {newShift.manager}</TableCell></TableRow>
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
                    {toDelete.length > 0 && (
                        <div className="max-h-60 overflow-y-auto border rounded-lg">
                        <Table>
                            <TableHeader><TableRow><TableHead>Operative</TableHead><TableHead>Date</TableHead><TableHead>Task</TableHead><TableHead>Address</TableHead></TableRow></TableHeader>
                            <TableBody>
                                {sortedDelete.map((shift, index) => (
                                    <TableRow key={index}><TableCell>{userNameMap.get(shift.userId) || shift.userId}</TableCell><TableCell>{format(shift.date.toDate(), 'dd/MM/yy')}</TableCell><TableCell>{shift.task}</TableCell><TableCell>{shift.address}</TableCell></TableRow>
                                ))}
                            </TableBody>
                        </Table>
                        </div>
                    )}
                </div>

                <div>
                    <h3 className="font-semibold flex items-center gap-2 mb-2">
                        <AlertCircle className="text-destructive" /> 
                        {failed.length} Rows Failed to Parse
                    </h3>
                     {failed.length > 0 && (
                        <div className="max-h-60 overflow-y-auto border rounded-lg">
                        <Table>
                            <TableHeader><TableRow><TableHead>Sheet</TableHead><TableHead>Cell</TableHead><TableHead>Date</TableHead><TableHead>Content</TableHead><TableHead>Reason</TableHead></TableRow></TableHeader>
                            <TableBody>
                                {failed.map((shift, index) => (
                                    <TableRow key={index}><TableCell>{shift.sheetName}</TableCell><TableCell className="font-mono text-xs">{shift.cellRef}</TableCell><TableCell>{shift.date ? format(shift.date, 'dd/MM/yy') : 'N/A'}</TableCell><TableCell className="font-mono text-xs">{shift.cellContent}</TableCell><TableCell>{shift.reason}</TableCell></TableRow>
                                ))}
                            </TableBody>
                        </Table>
                        </div>
                    )}
                </div>
            </CardContent>
             <CardFooter className="flex justify-end gap-2">
                <Button variant="outline" onClick={handleFileSelection} disabled={isConfirming}>Cancel</Button>
                <Button onClick={handleConfirmAndPublish} disabled={isConfirming}>
                    {isConfirming ? <Spinner /> : 'Confirm & Publish'}
                </Button>
            </CardFooter>
        </Card>
    );
  }

  return (
    <div className="space-y-8">
      
      {isPrivilegedUser && userProfile && !importAttempted && (
        <Card>
          <CardHeader>
            <CardTitle>Import Weekly Shifts from Excel</CardTitle>
            <CardDescription>
                Upload an Excel workbook. The tool will read shifts from all selected sheets. New shifts are added, existing ones updated, and shifts not in the file are removed. Use "Dry Run" to test before importing.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FileUploader onImportComplete={handleImportComplete} onFileSelect={handleFileSelection} userProfile={userProfile} />
          </CardContent>
        </Card>
      )}

      {importAttempted && importReport?.dryRun && renderDryRunReport()}

      {importAttempted && !importReport?.dryRun && (
          <>
            {importReport && importReport.failed.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <FileWarning className="text-destructive" />
                            Failed Import Report
                        </CardTitle>
                        <CardDescription>
                            The following {importReport.failed.length} shift(s) could not be imported. Please correct them in the source file and re-upload.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Sheet</TableHead>
                                    <TableHead>Cell</TableHead>
                                    <TableHead>Date</TableHead>
                                    <TableHead>Project Address</TableHead>
                                    <TableHead>Original Cell Content</TableHead>
                                    <TableHead>Reason for Failure</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {importReport.failed.map((shift, index) => (
                                    <TableRow key={index}>
                                        <TableCell>{shift.sheetName}</TableCell>
                                        <TableCell className="font-mono text-xs">{shift.cellRef}</TableCell>
                                        <TableCell>{shift.date ? format(shift.date, 'dd/MM/yyyy') : 'N/A'}</TableCell>
                                        <TableCell>{shift.projectAddress}</TableCell>
                                        <TableCell className="font-mono text-xs">{shift.cellContent}</TableCell>
                                        <TableCell>{shift.reason}</TableCell>
                                    </TableRow>
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
                        The file was processed successfully, and no errors were found. All shifts were reconciled.
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

    
