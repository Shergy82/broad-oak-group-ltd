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
  bNumber?: string;
  manager?: string;
};

export interface FailedShift {
  date: Date | null;
  projectAddress: string;
  cellContent: string;
  reason: string;
  sheetName: string;
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
// These functions help find specific cells and blocks based on the user's defined structure.

const findCellByText = (sheet: XLSX.WorkSheet, text: string): XLSX.CellObject | null => {
    for (const cellAddress in sheet) {
        if (cellAddress[0] === '!') continue;
        const cell = sheet[cellAddress];
        if (cell && cell.t === 's' && cell.v && typeof cell.v === 'string' && cell.v.trim().toUpperCase() === text.toUpperCase()) {
            return cell;
        }
    }
    return null;
};


const findRowsWithText = (sheet: XLSX.WorkSheet, text: string): number[] => {
    const rows: number[] = [];
    for (const cellAddress in sheet) {
        if (cellAddress[0] === '!') continue;
        const cell = sheet[cellAddress];
        if (cell && cell.t === 's' && cell.v && typeof cell.v === 'string' && cell.v.trim().toUpperCase() === text.toUpperCase()) {
            const decoded = XLSX.utils.decode_cell(cellAddress);
            if (!rows.includes(decoded.r)) {
                rows.push(decoded.r);
            }
        }
    }
    return rows.sort((a, b) => a - b);
}

const getCellValue = (sheet: XLSX.WorkSheet, row: number, col: number): string => {
    const cell = sheet[XLSX.utils.encode_cell({ r: row, c: col })];
    return cell ? String(cell.w || cell.v || '').trim() : '';
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
  
  const parseDate = (dateStr: string): Date | null => {
      if (!dateStr || typeof dateStr !== 'string') return null;

      // Handles formats like 'Mon 22-Jul', '22-Jul', etc.
      // The 'parse' function from date-fns is robust enough for this.
      const date = parse(dateStr, 'E dd-MMM', new Date());
      if (isValid(date)) return date;

      const date2 = parse(dateStr, 'dd-MMM', new Date());
      if (isValid(date2)) return date2;

      // Excel date serial number handling
      const excelEpoch = new Date(1899, 11, 30);
      const excelDateNumber = Number(dateStr);
      if (!isNaN(excelDateNumber)) {
          return addDays(excelEpoch, excelDateNumber);
      }
      
      return null;
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
        
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        
        let allShifts: ParsedShift[] = [];
        let allFailed: FailedShift[] = [];

        workbook.SheetNames.forEach(sheetName => {
          if (!enabledSheets[sheetName]) return;
          
          const sheet = workbook.Sheets[sheetName];
          const jobStartRows = findRowsWithText(sheet, "START OF NEW JOB");

          if (jobStartRows.length === 0) {
              return; // No jobs in this sheet
          }

          jobStartRows.forEach((startRow, index) => {
              const endOfBlockRow = (index + 1 < jobStartRows.length) ? jobStartRows[index + 1] - 1 : sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']).e.r : 1000;
              
              // --- 1. Find Headers and Anchors ---
              let jobManagerHeaderRow = -1;
              let addressHeaderRow = -1;
              let dateRow = -1;
              let addressEndRow = -1;

              for (let r = startRow + 1; r <= endOfBlockRow; r++) {
                  const cellA = getCellValue(sheet, r, 0);
                  if (cellA.toUpperCase() === "JOB MANAGER") jobManagerHeaderRow = r;
                  if (cellA.toUpperCase() === "ADDRESS") addressHeaderRow = r;
                  
                  // Find Date Row (light blue)
                  const cellF = getCellValue(sheet, r, 5); // Check column F for a date
                  if (cellF && parseDate(cellF)) {
                      dateRow = r;
                  }
                  
                  // Find Address End (dark blue)
                  const cellB = getCellValue(sheet, r, 1);
                  if (cellB && parseDate(cellB)) {
                      addressEndRow = r;
                  }
              }

              if (jobManagerHeaderRow === -1 || addressHeaderRow === -1 || dateRow === -1) return;

              // --- 2. Extract Manager and Address ---
              const managerName = getCellValue(sheet, jobManagerHeaderRow + 1, 0);

              let siteAddress = "";
              if (addressHeaderRow !== -1 && addressEndRow !== -1) {
                  for (let r = addressHeaderRow + 1; r < addressEndRow; r++) {
                      const addrPart = getCellValue(sheet, r, 0);
                      if (addrPart) {
                          siteAddress += (siteAddress ? '\n' : '') + addrPart;
                      }
                  }
              }

              // --- 3. Extract Dates ---
              const dates: { col: number; date: Date }[] = [];
              for (let c = 5; c < 50; c++) { // Check up to column AX
                  const dateStr = getCellValue(sheet, dateRow, c);
                  if (!dateStr) break;
                  const parsed = parseDate(dateStr);
                  if (parsed) {
                      dates.push({ col: c, date: parsed });
                  }
              }
              if (dates.length === 0) return;

              // --- 4. Identify Shift Grid and Parse Shifts ---
              const gridStartRow = dateRow + 1;
              const gridEndRow = endOfBlockRow;
              
              for (let r = gridStartRow; r <= gridEndRow; r++) {
                  for (const { col, date } of dates) {
                      const cellContent = getCellValue(sheet, r, col);
                      if (!cellContent) continue;

                      const parts = cellContent.split('-').map(p => p.trim());
                      if (parts.length < 2) {
                          allFailed.push({ date, projectAddress: siteAddress, cellContent, reason: "Invalid format. Expected 'Task - User'.", sheetName });
                          continue;
                      }

                      const task = parts.slice(0, -1).join('-').trim();
                      const userName = parts[parts.length - 1].trim().toUpperCase();
                      const userId = userMap.get(userName);

                      if (!userId) {
                          allFailed.push({ date, projectAddress: siteAddress, cellContent, reason: `User '${userName}' not found in the system.`, sheetName });
                          continue;
                      }

                      allShifts.push({
                          task,
                          userName: parts[parts.length - 1].trim(), // Keep original casing for display
                          userId,
                          date,
                          address: siteAddress,
                          manager: managerName,
                          type: 'all-day', // Defaulting to all-day as type is not specified in the grid
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
