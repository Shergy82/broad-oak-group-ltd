'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FileUploader } from '@/components/admin/file-uploader';
import { ShiftScheduleOverview } from '@/components/admin/shift-schedule-overview';

export default function AdminPage() {
  return (
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <CardTitle>Import Weekly Shifts from Excel</CardTitle>
           <div className="text-sm text-muted-foreground space-y-2 pt-1">
            <p>
              Upload an .xlsx file to schedule all tasks for one or more projects for one week.
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <strong>Multiple Projects:</strong> You can include multiple projects in a single sheet.
              </li>
              <li>
                <strong>Project Address:</strong> The full address for a project goes in the first column (Column A). This address will apply to all task rows below it until a new address is specified in Column A.
              </li>
              <li>
                <strong>Date Row:</strong> The importer will automatically find the row containing the week's dates (e.g., in DD/MM/YYYY format). This row must be above the task data.
              </li>
               <li>
                <strong>Task & Operative Cells:</strong> In the grid, each cell corresponding to a date should contain the task description, a hyphen, and the operative's full name.
                The format must be: <code>Task Description - Operative Name</code>. Spacing around the hyphen does not matter.
              </li>
              <li>
                <strong>Operative Name Matching:</strong> The operative's name in the sheet must exactly match their full name in the user list above.
              </li>
               <li>
                <strong>Shift Type:</strong> All imported tasks are automatically assigned as 'All Day' shifts.
              </li>
              <li>
                <strong>Ignored Cells:</strong> Any cells that are empty, do not contain a recognized 'Task - Name' format, or contain words like `holiday` or `on hold` will be skipped.
              </li>
            </ul>
            <p className="font-semibold pt-2">Example Structure:</p>
            <pre className="mt-2 rounded-md bg-muted p-4 text-xs font-mono overflow-x-auto">
{`+--------------------------------+----------------------------+--------------------------------+
| A (Address)                    | B (Date ->)                | C (Date ->)                    |
+--------------------------------+----------------------------+--------------------------------+
|                                | 09/06/2025                 | 10/06/2025                     |
+--------------------------------+----------------------------+--------------------------------+
| 9 Eardley Crescent...          | FIT TRAY - Phil Shergold   | STUD WALL... - Phil Shergold   |
+--------------------------------+----------------------------+--------------------------------+
|                                | TAKE OUT WINDOW - Phil S.  | TAKE OUT WINDOW - Phil S.      |
+--------------------------------+----------------------------+--------------------------------+
| 14 Oak Avenue...               | PLUMBING PREP - John Doe   | EXTERNAL PAINTING - Jane Smith |
+--------------------------------+----------------------------+--------------------------------+`}
            </pre>
          </div>
        </CardHeader>
        <CardContent>
          <FileUploader />
        </CardContent>
      </Card>
      <ShiftScheduleOverview />
    </div>
  );
}
