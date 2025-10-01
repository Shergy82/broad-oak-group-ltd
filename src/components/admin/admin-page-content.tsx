
'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { FileUploader, FailedShift } from '@/components/admin/file-uploader';
import { ShiftScheduleOverview } from '@/components/admin/shift-schedule-overview';
import { useUserProfile } from '@/hooks/use-user-profile';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Download, FileWarning, CheckCircle } from 'lucide-react';
import { format } from 'date-fns';
import { functions, httpsCallable } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { Spinner } from '../shared/spinner';
import { Alert, AlertTitle, AlertDescription } from '../ui/alert';


export default function AdminPageContent() {
  const { userProfile } = useUserProfile();
  const [failedShifts, setFailedShifts] = useState<FailedShift[]>([]);
  const [importAttempted, setImportAttempted] = useState(false);
  const isPrivilegedUser = userProfile && ['admin', 'owner'].includes(userProfile.role);
  const isOwner = userProfile && userProfile.role === 'owner';

  const handleImportComplete = (report: FailedShift[]) => {
    const sortedReport = report.sort((a, b) => {
        if (!a.date) return 1;
        if (!b.date) return -1;
        return a.date.getTime() - b.date.getTime();
    });
    setFailedShifts(sortedReport);
    setImportAttempted(true);
  };
  
  const handleFileSelection = () => {
    setImportAttempted(false);
    setFailedShifts([]);
  };

  const handleDownloadPdf = async () => {
    const { default: jsPDF } = await import('jspdf');
    const { default: autoTable } = await import('jspdf-autotable');

    const doc = new jsPDF();
    const generationDate = new Date();

    doc.setFontSize(18);
    doc.text(`Failed Shift Import Report`, 14, 22);
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(`Generated on: ${format(generationDate, 'PPP p')}`, 14, 28);
    
    const head = [['Date', 'Project Address', 'Original Cell Content', 'Reason for Failure']];
    const body = failedShifts.map(shift => [
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

  return (
    <div className="space-y-8">
      
      {isPrivilegedUser && (
        <Card>
          <CardHeader>
            <CardTitle>Import Weekly Shifts from Excel</CardTitle>
            <div className="text-sm text-muted-foreground space-y-2 pt-1">
              <p>
                Upload an .xlsx file to schedule all tasks for one or more projects for one week. This importer will add and update shifts based on the file, but it will not create new project entries on the 'Projects' page.
              </p>
              <p className="font-bold text-destructive/90">
                Important: Shifts are reconciled on import. New shifts are added, changed shifts are updated, and shifts no longer present in the file are deleted. Notifications are only sent for new or changed shifts.
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  <strong>Project Details:</strong> The importer looks for a 'Project Address' in Column A and a 'B Number' in Column B. Any rows below that address will be associated with it until a new address is found in Column A.
                </li>
                <li>
                  <strong>Date Row:</strong> The importer will automatically find the row containing the week's dates (e.g., in DD/MM/YYYY format), which must be above the task data. Daily shift columns start from Column C.
                </li>
                <li>
                  <strong>Task & Operative Cells:</strong> In the grid, each cell corresponding to a date should contain the task description, a hyphen, and the operative's full name.
                  The format must be: <code>Task Description - Operative Name</code>. Spacing around the hyphen does not matter.
                </li>
                <li>
                  <strong>Shift Type (AM/PM):</strong> You can specify a morning or afternoon shift by adding "AM" or "PM" to the task description (e.g., <code>FIT TRAY AM - Phil Shergold</code>). If neither is found, the shift will default to 'All Day'.
                </li>
                <li>
                  <strong>Operative Name Matching:</strong> The operative's name in the sheet must exactly match their full name in the user list above.
                </li>
                <li>
                  <strong>Ignored Cells:</strong> Any cells that are empty, do not contain a recognized 'Task - Name' format, contain parentheses `()`, or contain words like `holiday` or `on hold` will be skipped.
                </li>
              </ul>
              <p className="font-semibold pt-2">Example Structure:</p>
              <pre className="mt-2 rounded-md bg-muted p-4 text-xs font-mono overflow-x-auto">
{`+------------------------+--------------+-----------------------------+------------------------------+
| A (Project Address)    | B (B Number) | C (Date ->)                 | D (Date ->)                  |
+------------------------+--------------+-----------------------------+------------------------------+
|                        |              | 09/06/2025                  | 10/06/2025                   |
+------------------------+--------------+-----------------------------+------------------------------+
| 9 Eardley Crescent,... | B-123        | FIT TRAY AM - Phil Shergold | STUD WALL PM - Phil Shergold |
+------------------------+--------------+-----------------------------+------------------------------+
| 14 Oak Avenue,...      | B-456        | PLUMBING PREP - John Doe    | EXT. PAINTING - Jane Smith   |
+------------------------+--------------+-----------------------------+------------------------------+`}
              </pre>
            </div>
          </CardHeader>
          <CardContent>
            <FileUploader onImportComplete={handleImportComplete} onFileSelect={handleFileSelection} />
          </CardContent>
        </Card>
      )}

      {importAttempted && failedShifts.length > 0 && (
          <Card>
              <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                      <FileWarning className="text-destructive" />
                      Failed Import Report
                  </CardTitle>
                  <CardDescription>
                      The following {failedShifts.length} shift(s) could not be imported. Please correct them in the source file and re-upload.
                  </CardDescription>
              </CardHeader>
              <CardContent>
                  <Table>
                      <TableHeader>
                          <TableRow>
                              <TableHead>Date</TableHead>
                              <TableHead>Project Address</TableHead>
                              <TableHead>Original Cell Content</TableHead>
                              <TableHead>Reason for Failure</TableHead>
                          </TableRow>
                      </TableHeader>
                      <TableBody>
                          {failedShifts.map((shift, index) => (
                              <TableRow key={index}>
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

      {importAttempted && failedShifts.length === 0 && (
          <Alert className="border-green-500 text-green-700">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <AlertTitle>Import Successful</AlertTitle>
              <AlertDescription>
                  The file was processed successfully, and no errors were found. All shifts were reconciled.
              </AlertDescription>
          </Alert>
      )}
      
      {isPrivilegedUser && userProfile && (
         <ShiftScheduleOverview userProfile={userProfile} />
      )}

    </div>
  );
}
