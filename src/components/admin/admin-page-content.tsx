
'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { FileUploader, FailedShift } from '@/components/admin/file-uploader';
import { ShiftScheduleOverview } from '@/components/admin/shift-schedule-overview';
import { useUserProfile } from '@/hooks/use-user-profile';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Download, FileWarning, CheckCircle, TestTube2, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { Alert, AlertTitle, AlertDescription } from '../ui/alert';

interface DryRunResult {
    found: any[];
    failed: FailedShift[];
}

export default function AdminPageContent() {
  const { userProfile } = useUserProfile();
  const [importReport, setImportReport] = useState<{ failed: FailedShift[], dryRun?: DryRunResult } | null>(null);
  const [importAttempted, setImportAttempted] = useState(false);
  const isPrivilegedUser = userProfile && ['admin', 'owner'].includes(userProfile.role);

  const handleImportComplete = (failedShifts: FailedShift[], dryRunResult?: DryRunResult) => {
    const sortedFailed = failedShifts.sort((a, b) => {
        if (!a.date) return 1;
        if (!b.date) return -1;
        return a.date.getTime() - b.date.getTime();
    });
    setImportReport({ failed: sortedFailed, dryRun: dryRunResult });
    setImportAttempted(true);
  };
  
  const handleFileSelection = () => {
    setImportAttempted(false);
    setImportReport(null);
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
    if (!importReport?.dryRun) return null;

    const { found, failed } = importReport.dryRun;

    return (
        <Card className="mt-6 border-blue-500">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-blue-600">
                    <TestTube2 />
                    Dry Run Results
                </CardTitle>
                <CardDescription>
                    This is a preview of the import from the selected sheets. No changes have been made to the database.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div>
                    <h3 className="font-semibold flex items-center gap-2 mb-2">
                        <CheckCircle className="text-green-600" /> 
                        {found.length} Shifts Found Successfully
                    </h3>
                    {found.length > 0 ? (
                        <div className="max-h-60 overflow-y-auto border rounded-lg">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Date</TableHead>
                                    <TableHead>Operative</TableHead>
                                    <TableHead>Task</TableHead>
                                    <TableHead>Address</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {found.map((shift, index) => (
                                    <TableRow key={index}>
                                        <TableCell>{format(shift.date, 'dd/MM/yy')}</TableCell>
                                        <TableCell>{userProfile?.uid === shift.userId ? userProfile.name : shift.userId}</TableCell>
                                        <TableCell>{shift.task}</TableCell>
                                        <TableCell>{shift.address}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                        </div>
                    ) : <p className="text-sm text-muted-foreground">No shifts could be parsed from the file.</p>}
                </div>

                <div>
                    <h3 className="font-semibold flex items-center gap-2 mb-2">
                        <AlertCircle className="text-destructive" /> 
                        {failed.length} Rows Failed to Parse
                    </h3>
                     {failed.length > 0 ? (
                        <div className="max-h-60 overflow-y-auto border rounded-lg">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Sheet</TableHead>
                                    <TableHead>Date</TableHead>
                                    <TableHead>Cell Content</TableHead>
                                    <TableHead>Reason</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {failed.map((shift, index) => (
                                    <TableRow key={index}>
                                        <TableCell>{shift.sheetName}</TableCell>
                                        <TableCell>{shift.date ? format(shift.date, 'dd/MM/yy') : 'N/A'}</TableCell>
                                        <TableCell className="font-mono text-xs">{shift.cellContent}</TableCell>
                                        <TableCell>{shift.reason}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                        </div>
                    ) : <p className="text-sm text-muted-foreground">No errors found during parsing.</p>}
                </div>
            </CardContent>
             <CardFooter>
                <p className="text-xs text-muted-foreground">If these results look correct, uncheck "Dry Run" and import the file again to apply the changes.</p>
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
                Upload an Excel workbook. The tool will read shifts from all selected sheets. New shifts are added, existing ones updated, and shifts not in the file are removed. Use "Dry Run" to test before importing.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FileUploader onImportComplete={handleImportComplete} onFileSelect={handleFileSelection} />
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
