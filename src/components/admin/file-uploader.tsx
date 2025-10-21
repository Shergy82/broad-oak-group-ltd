'use client';

import { useState } from 'react';
import * as XLSX from 'xlsx';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/shared/spinner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Upload, FileWarning, Sheet } from 'lucide-react';
import { Label } from '../ui/label';
import { Switch } from '@/components/ui/switch';
import { useAllUsers } from '@/hooks/use-all-users';
import { db } from '@/lib/firebase';
import { writeBatch, collection, doc, Timestamp, serverTimestamp }from 'firebase/firestore';
import type { UserProfile } from '@/types';


export interface FailedShift {
  userText: string;
  taskText: string;
  date: string;
  row: number;
  reason: string;
}

export interface ReconciliationResult {
    add: any[];
    update: any[];
    delete: any[];
}


interface FileUploaderProps {
  onImportComplete: (failedShifts: FailedShift[], dryRunResult?: ReconciliationResult) => void;
  onFileSelect: () => void;
}

export function FileUploader({ onImportComplete, onFileSelect }: FileUploaderProps) {
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [enabledSheets, setEnabledSheets] = useState<{ [key: string]: boolean }>({});
  const { users: allUsers, loading: usersLoading } = useAllUsers();
  const [isDryRun, setIsDryRun] = useState(true);
  
  const { toast } = useToast();

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      const selectedFile = event.target.files[0];
      if (selectedFile) {
        setFile(selectedFile);
        setError(null);
        onFileSelect(); 

        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const data = e.target?.result;
            if (!data) throw new Error("Could not read file.");
            const workbook = XLSX.read(data, { type: 'array', bookSheets: true });
            const names = workbook.SheetNames;
            setSheetNames(names);
            const initialEnabled: { [key: string]: boolean } = {};
            names.forEach(name => {
              initialEnabled[name] = true;
            });
            setEnabledSheets(initialEnabled);
          } catch (err: any) {
             setError(`Error reading workbook structure: ${err.message}`);
          }
        };
        reader.onerror = () => {
           setError(`Failed to read the file.`);
        }
        reader.readAsArrayBuffer(selectedFile);
      }
    }
  };

  const toggleSheet = (sheetName: string, isEnabled: boolean) => {
    setEnabledSheets(prev => ({ ...prev, [sheetName]: isEnabled }));
  }

  // Helper to find a user by matching their name from the sheet
  const findUserByName = (name: string, users: UserProfile[]): UserProfile | undefined => {
    const normalizedName = name.trim().toLowerCase();
    return users.find(u => u.name.toLowerCase() === normalizedName);
  };

  // Main processing function
  const handleProcessFile = async () => {
    if (!file) {
      setError('Please select a file first.');
      return;
    }
    if (usersLoading) {
      setError('Waiting for user data to load...');
      return;
    }

    setIsProcessing(true);
    setError(null);
    toast({ title: "Processing File...", description: "Reading shifts from the selected sheets." });

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = e.target?.result;
            if (!data) throw new Error("Could not read file data.");
            const workbook = XLSX.read(data, { type: 'array' });
            
            const parsedShifts: any[] = [];
            const failedShifts: FailedShift[] = [];

            for (const sheetName of workbook.SheetNames) {
                if (!enabledSheets[sheetName]) continue;

                const sheet = workbook.Sheets[sheetName];
                const json: (string | number)[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
                
                // Find date rows first
                const dateRows = new Map<number, (string|number)[]>();
                json.forEach((row, rowIndex) => {
                    // A date row has dates starting from column F (index 5)
                    if (row[5] && /^\d{1,2}-[A-Za-z]{3}$/.test(String(row[5]))) {
                        dateRows.set(rowIndex, row);
                    }
                });

                if (dateRows.size === 0) {
                    continue; // No dates found in this sheet
                }

                // Simplified parsing logic
                json.forEach((row, rowIndex) => {
                    row.forEach((cell, colIndex) => {
                        if (colIndex < 5 || !cell) return; // Only look in shift grid area

                        const cellText = String(cell);
                        if (cellText.includes(' - ')) { // Potential shift
                            const [taskText, userText] = cellText.split(' - ').map(s => s.trim());
                            if (!taskText || !userText) {
                                return; // Not a valid shift format
                            }
                            
                            // Find the date for this column by looking up
                            let dateValue: string | number | null = null;
                            let dateRowIndex = -1;

                            // Find the closest date row *above* the current row
                            let closestRowAbove = -1;
                            for (const d_rowIndex of dateRows.keys()) {
                                if (d_rowIndex < rowIndex && d_rowIndex > closestRowAbove) {
                                    closestRowAbove = d_rowIndex;
                                }
                            }

                            if (closestRowAbove !== -1) {
                                const dateRow = dateRows.get(closestRowAbove);
                                if (dateRow && dateRow[colIndex]) {
                                    dateValue = dateRow[colIndex];
                                    dateRowIndex = closestRowAbove;
                                }
                            }

                            if (!dateValue) {
                                failedShifts.push({ userText, taskText, date: 'Unknown', row: rowIndex + 1, reason: `Could not find a date for this shift.` });
                                return;
                            }

                            const user = findUserByName(userText, allUsers);
                            if (!user) {
                                failedShifts.push({ userText, taskText, date: String(dateValue), row: rowIndex + 1, reason: `User '${userText}' not found.` });
                                return;
                            }
                            
                            try {
                                const jsDate = XLSX.SSF.parse_date_code(Number(dateValue));
                                const correctedDate = new Date(Date.UTC(jsDate.y, jsDate.m - 1, jsDate.d));

                                parsedShifts.push({
                                    userId: user.uid,
                                    userName: user.name,
                                    date: Timestamp.fromDate(correctedDate),
                                    type: 'all-day', // Simplified for now
                                    status: 'pending-confirmation',
                                    address: 'Address Not Parsed', // Simplified
                                    task: taskText,
                                    manager: 'Manager Not Parsed', // Simplified
                                    createdAt: serverTimestamp(),
                                });
                            } catch (dateError) {
                                failedShifts.push({ userText, taskText, date: String(dateValue), row: rowIndex + 1, reason: `Invalid date format.` });
                            }
                        }
                    });
                });
            }

            if (!isDryRun) {
                if(parsedShifts.length > 0) {
                    const batch = writeBatch(db);
                    parsedShifts.forEach(shift => {
                        const newShiftRef = doc(collection(db, 'shifts'));
                        batch.set(newShiftRef, shift);
                    });
                    await batch.commit();
                    toast({ title: "Import Successful", description: `${parsedShifts.length} shifts have been added.` });
                } else if (failedShifts.length === 0) {
                    toast({ title: "No new shifts to import", variant: "default" });
                }
            }
            
            onImportComplete(failedShifts, isDryRun ? { add: parsedShifts, update: [], delete: [] } : undefined);
            
            // For now, let's just show a success toast if we got here without crashing
             if(isDryRun){
                toast({ title: `Dry Run Complete`, description: `Found ${parsedShifts.length} valid shifts and ${failedShifts.length} errors.` });
            }

        } catch (err: any) {
            setError(`Failed to process file. Error: ${err.message}`);
            toast({ variant: "destructive", title: "Processing Error", description: err.message });
        } finally {
            setIsProcessing(false);
        }
    };
    reader.readAsArrayBuffer(file);
  };
  
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
          accept=".xlsx, .xls, .xlsb"
          onChange={handleFileChange}
          className="w-full file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer"
        />

        {sheetNames.length > 0 && (
          <div className="space-y-3 rounded-lg border p-4">
            <h3 className="text-sm font-medium">Select Sheets to Read</h3>
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

        <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
           <div className="flex items-center space-x-2">
                <Switch 
                    id="dry-run-switch" 
                    checked={isDryRun} 
                    onCheckedChange={setIsDryRun}
                />
                <Label htmlFor="dry-run-switch">Dry Run</Label>
            </div>
          <Button onClick={handleProcessFile} disabled={!file || isProcessing || usersLoading} className="w-full sm:w-auto">
            {isProcessing || usersLoading ? <Spinner /> : <><Upload className="mr-2 h-4 w-4" /> {isDryRun ? "Run Reconciliation" : "Import Shifts"} </>}
          </Button>
        </div>
      </div>
    </div>
  );
}
