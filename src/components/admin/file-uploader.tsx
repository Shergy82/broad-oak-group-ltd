'use client';

import { useState } from 'react';
import * as XLSX from 'xlsx';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/shared/spinner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Upload, FileWarning, TestTube2, Sheet } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '../ui/label';
import type { UserProfile } from '@/types';
import { useAllUsers } from '@/hooks/use-all-users';
import { addDays, isValid, parse } from 'date-fns';


// Define the data structures we will be working with
export type ParsedShift = {
  task: string;
  userId: string;
  userName: string;
  date: Date;
  address: string;
  type: 'am' | 'pm' | 'all-day';
  manager: string;
};

export interface FailedShift {
  date: Date | null;
  projectAddress: string;
  cellContent: string;
  reason: string;
  sheetName: string;
  rowNumber: number;
}

export interface ReconciliationResult {
  toCreate: ParsedShift[];
  toUpdate: { id: string; data: Partial<any> }[];
  toDelete: string[];
  failed: FailedShift[];
}

interface FileUploaderProps {
  onImportComplete: (failedShifts: FailedShift[], dryRunResult?: ReconciliationResult) => void;
  onFileSelect: () => void;
  shiftsToPublish?: ReconciliationResult | null;
  children?: React.ReactNode;
}

// --- Cell Parsing Utilities ---
const getCellValue = (sheet: XLSX.WorkSheet, row: number, col: number): string => {
    const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
    const cell = sheet[cellAddress];
    // Use .w for formatted text, fallback to .v for raw value
    return cell ? String(cell.w || cell.v || '').trim() : '';
};

const findRowsWithText = (sheet: XLSX.WorkSheet, text: string): number[] => {
    const rows: number[] = [];
    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
    for (let R = range.s.r; R <= range.e.r; ++R) {
        const cellValue = getCellValue(sheet, R, 0); // Only check Column A
        if (cellValue.toUpperCase() === text.toUpperCase()) {
            rows.push(R);
        }
    }
    return rows.sort((a, b) => a - b);
}

const parseDate = (dateStr: string): Date | null => {
    if (!dateStr || typeof dateStr !== 'string') return null;

    // Handles formats like 'Mon 22-Jul', '22-Jul', etc.
    const date = parse(dateStr, 'E dd-MMM', new Date());
    if (isValid(date)) return date;
    
    const date2 = parse(dateStr, 'dd-MMM', new Date());
    if (isValid(date2)) return date2;

    // Handle Excel's date serial number format
    const excelDateNumber = Number(dateStr);
    if (!isNaN(excelDateNumber) && excelDateNumber > 1) {
        // Excel's epoch starts on 1900-01-01, but it incorrectly treats 1900 as a leap year.
        // It's safer to use the 'date-fns' addDays function with a known epoch.
        const excelEpoch = new Date(1899, 11, 30);
        return addDays(excelEpoch, excelDateNumber);
    }
      
    return null;
}

const isDateRow = (sheet: XLSX.WorkSheet, row: number): boolean => {
    // A row is considered a date row if at least one cell from column F onwards is a valid date.
    for (let C = 5; C < 50; C++) { // Check from col F onwards
        const cellValue = getCellValue(sheet, row, C);
        if (cellValue && parseDate(cellValue)) {
            return true;
        }
        if (C > 7 && !cellValue) break; // Optimization: stop if we see a blank after a couple of dates
    }
    return false;
};


export function FileUploader({ onImportComplete, onFileSelect, shiftsToPublish, children }: FileUploaderProps) {
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDryRun, setIsDryRun] = useState(true);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [enabledSheets, setEnabledSheets] = useState<{ [key: string]: boolean }>({});
  const { users, loading: usersLoading } = useAllUsers();
  const { toast } = useToast();

  const userMap = new Map<string, string>();
  users.forEach(u => userMap.set(u.name.toUpperCase(), u.uid));


  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      const selectedFile = event.target.files[0];
      if (selectedFile) {
        setFile(selectedFile);
        setError(null);
        onFileSelect();

        const reader = new FileReader();
        reader.onload = (e) => {
          const data = e.target?.result;
          if (!data) return;
          const workbook = XLSX.read(data, { type: 'array', bookSheets: true });
          const names = workbook.SheetNames;
          setSheetNames(names);
          const initialEnabled: { [key: string]: boolean } = {};
          names.forEach(name => {
            initialEnabled[name] = true;
          });
          setEnabledSheets(initialEnabled);
        };
        reader.readAsArrayBuffer(selectedFile);
      }
    }
  };

  const toggleSheet = (sheetName: string, isEnabled: boolean) => {
    setEnabledSheets(prev => ({ ...prev, [sheetName]: isEnabled }));
  }

  const handleProcessFile = async () => {
    if (!file) {
      setError('Please select a file first.');
      return;
    }
    if (usersLoading) {
      setError("Still loading user data. Please wait a moment and try again.");
      return;
    }
    setIsProcessing(true);
    setError(null);
    toast({ title: "Processing File...", description: "Reading shifts from the selected sheets." });

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        if (!data) throw new Error("Could not read file data.");
        
        const workbook = XLSX.read(data, { type: 'array', cellDates: true, cellStyles: true });
        
        let allShifts: ParsedShift[] = [];
        let allFailed: FailedShift[] = [];

        workbook.SheetNames.forEach(sheetName => {
            if (!enabledSheets[sheetName]) return;
            
            const sheet = workbook.Sheets[sheetName];
            if (!sheet || !sheet['!ref']) return;

            const jobStartRows = findRowsWithText(sheet, "START OF NEW JOB");

            jobStartRows.forEach((jobStartRow, index) => {
                const endOfBlockRow = (index + 1 < jobStartRows.length) ? jobStartRows[index + 1] - 1 : XLSX.utils.decode_range(sheet['!ref']!).e.r;
                
                // --- Step 3: Get Manager Name ---
                const jobManagerHeaderRow = jobStartRow + 2; // "JOB MANAGER" header
                const managerName = getCellValue(sheet, jobManagerHeaderRow + 1, 0); // Name is below header
                
                let addressHeaderRow = -1;
                let dateBoundaryRowForAddress = -1;
                let dateRow = -1;
                let gridStartRow = -1;
                let gridEndRow = -1;
                
                // Scan to find the key rows based on their content/structure
                for (let r = jobManagerHeaderRow + 2; r <= endOfBlockRow; r++) {
                    if (getCellValue(sheet, r, 0).toUpperCase() === 'ADDRESS' && addressHeaderRow === -1) {
                        addressHeaderRow = r;
                    }
                    // Look for the dark blue date boundary row
                    if (addressHeaderRow !== -1 && dateBoundaryRowForAddress === -1 && getCellValue(sheet, r, 0) && parseDate(getCellValue(sheet, r, 0))) {
                        dateBoundaryRowForAddress = r;
                    }
                    // Look for the light blue date row
                    if (isDateRow(sheet, r) && dateRow === -1) {
                        dateRow = r;
                        gridStartRow = r + 1; // Grid starts right after the date row
                    }
                }

                // The grid ends before the next job starts, or at the end of the block
                gridEndRow = endOfBlockRow;


                // --- Step 4: Get Site Address ---
                let siteAddress = "";
                if (addressHeaderRow !== -1 && dateBoundaryRowForAddress !== -1) {
                    for (let r = addressHeaderRow + 1; r < dateBoundaryRowForAddress; r++) {
                        const addrPart = getCellValue(sheet, r, 0);
                        if (addrPart) {
                            siteAddress += (siteAddress ? '\n' : '') + addrPart;
                        }
                    }
                }

                if (!siteAddress) { // Fallback if structure is slightly different
                    siteAddress = `Project from sheet '${sheetName}'`;
                }
                
                // --- Step 5 & 7: Find Dates and Parse Shifts ---
                if (dateRow === -1 || gridStartRow === -1) return; // Cannot proceed without a date row
                
                const dates: { col: number; date: Date }[] = [];
                for (let c = 5; c < 50; c++) { // Check from col F up to AX
                    const dateStr = getCellValue(sheet, dateRow, c);
                    if (!dateStr) break;
                    const parsed = parseDate(dateStr);
                    if (parsed) {
                        dates.push({ col: c, date: parsed });
                    }
                }
                if (dates.length === 0) return;


                // --- Step 6 & 7: Scan Grid and Parse Shifts ---
                for (let r = gridStartRow; r <= gridEndRow; r++) {
                    // Check if this row is the start of the next job block and stop
                    if (getCellValue(sheet, r, 0).toUpperCase() === 'START OF NEW JOB') {
                        break;
                    }
                    
                    for (const { col, date } of dates) {
                        const cellContent = getCellValue(sheet, r, col);
                        if (!cellContent) continue;

                        const parts = cellContent.split('-').map(p => p.trim());
                        if (parts.length < 2) {
                            allFailed.push({ date, projectAddress: siteAddress, cellContent, reason: "Invalid format. Expected 'Task - User'.", sheetName, rowNumber: r + 1 });
                            continue;
                        }

                        const task = parts.slice(0, -1).join('-').trim();
                        const userNameFromCell = parts[parts.length - 1].trim();
                        const userId = userMap.get(userNameFromCell.toUpperCase());

                        if (!userId) {
                            allFailed.push({ date, projectAddress: siteAddress, cellContent, reason: `User '${userNameFromCell}' not found in the system.`, sheetName, rowNumber: r + 1 });
                            continue;
                        }

                        // Determine shift type (am/pm/all-day)
                        let shiftType: 'am' | 'pm' | 'all-day' = 'all-day';
                        const cellAbove = getCellValue(sheet, r - 1, col).toUpperCase();
                        if (cellAbove.includes('AM')) {
                            shiftType = 'am';
                        } else if (cellAbove.includes('PM')) {
                            shiftType = 'pm';
                        }
                        
                        allShifts.push({
                          task,
                          userName: userNameFromCell, // Keep original casing for display
                          userId,
                          date,
                          address: siteAddress,
                          manager: managerName,
                          type: shiftType, 
                        });
                    }
                }
            });
        });

        // In a real scenario, this is where you'd reconcile with existing shifts.
        // For now, we will just treat them all as new creations for the dry run.
        const dryRunResult: ReconciliationResult = {
          toCreate: allShifts,
          toUpdate: [],
          toDelete: [],
          failed: allFailed,
        };

        onImportComplete(allFailed, dryRunResult);

      } catch (err: any) {
        setError(`Failed to process file. Error: ${err.message}`);
        toast({ variant: "destructive", title: "Processing Error", description: err.message });
      } finally {
        setIsProcessing(false);
      }
    };
    reader.readAsArrayBuffer(file);
  };
  
  if (shiftsToPublish) {
    return <div onClick={() => {}}>{children}</div>;
  }

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <FileWarning className="h-4 w-4" />
          <AlertTitle>Import Error</AlertTitle>
          <AlertDescription style={{ whiteSpace: 'pre-wrap' }}>{error}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-4">
        <Input
          id="shift-file-input"
          type="file"
          accept=".xlsx, .xls"
          onChange={handleFileChange}
          className="w-full file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer"
        />

        {sheetNames.length > 0 && (
          <div className="space-y-3 rounded-lg border p-4">
            <h3 className="text-sm font-medium">Select Sheets to Import</h3>
            <div className="space-y-2">
              {sheetNames.map(name => (
                <div key={name} className="flex items-center justify-between rounded-md border p-3">
                  <Label htmlFor={`sheet-${name}`} className="flex items-center gap-2 text-sm font-normal">
                    <Sheet className="h-4 w-4 text-muted-foreground" />
                    {name}
                  </Label>
                  <Switch
                    id={`sheet-${name}`}
                    checked={!!enabledSheets[name]}
                    onCheckedChange={(checked) => toggleSheet(name, checked)}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-4 items-center">
          <div className="flex items-center space-x-2">
            <Switch id="dry-run" checked={isDryRun} onCheckedChange={setIsDryRun} />
            <Label htmlFor="dry-run" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              Dry Run (Preview changes before publishing)
            </Label>
          </div>
          <Button onClick={handleProcessFile} disabled={!file || isProcessing || usersLoading} className="w-full sm:w-auto ml-auto">
            {isProcessing ? <Spinner /> : isDryRun ? <><TestTube2 className="mr-2 h-4 w-4" /> Run Test</> : <><Upload className="mr-2 h-4 w-4" /> Import & Publish</>}
          </Button>
        </div>
      </div>
    </div>
  );
}
