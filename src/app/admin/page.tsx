
'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FileUploader } from '@/components/admin/file-uploader';
import { ShiftScheduleOverview } from '@/components/admin/shift-schedule-overview';
import { VapidKeyGenerator } from '@/components/admin/vapid-key-generator';
import { TestNotificationSender } from '@/components/admin/test-notification-sender';
import { useUserProfile } from '@/hooks/use-user-profile';

export default function AdminPage() {
  const { userProfile } = useUserProfile();
  const isPrivilegedUser = userProfile && ['admin', 'owner'].includes(userProfile.role);

  return (
    <div className="space-y-8">
      
      {isPrivilegedUser && (
        <Card>
          <CardHeader>
            <CardTitle>Import Weekly Shifts from Excel</CardTitle>
            <div className="text-sm text-muted-foreground space-y-2 pt-1">
              <p>
                Upload an .xlsx file to schedule all tasks for one or more projects for one week. This will also create project entries on the 'Projects' page if they don't already exist.
              </p>
              <p className="font-bold text-destructive/90">
                Important: Uploading a file will delete all existing shifts for the dates found in that file and replace them with the new schedule.
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
                  <strong>Shift Type (AM/PM):</strong> You can optionally add "AM" or "PM" to the task description (e.g., <code>FIT TRAY AM - Phil Shergold</code>). If neither is found, the shift will default to 'All Day'.
                </li>
                <li>
                  <strong>Operative Name Matching:</strong> The operative's name in the sheet must exactly match their full name in the user list above.
                </li>
                <li>
                  <strong>Ignored Cells:</strong> Any cells that are empty, do not contain a recognized 'Task - Name' format, or contain words like `holiday` or `on hold` will be skipped.
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
            <FileUploader />
          </CardContent>
        </Card>
      )}

      <VapidKeyGenerator />

      <TestNotificationSender />
      
      <ShiftScheduleOverview />
    </div>
  );
}
