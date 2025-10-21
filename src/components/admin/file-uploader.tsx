'use client';

import { useState } from 'react';
import * as XLSX from 'xlsx';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/shared/spinner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Upload, FileWarning, Sheet, Check, CircleX } from 'lucide-react';
import { Label } from '../ui/label';
import { Switch } from '@/components/ui/switch';
import { useAllUsers } from '@/hooks/use-all-users';
import { db } from '@/lib/firebase';
import { writeBatch, collection, Timestamp, serverTimestamp } from 'firebase/firestore';
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
                
                let currentManager = '';
                let currentAddress = '';
                let dateRow: (string | number)[] = [];
                let dateRowIndex = -1;

                let inJobBlock = false;
                let addressLines: string[] = [];

                for (let i = 0; i < json.length; i++) {
                    const row = json[i];
                    const firstCell = row[0] ? String(row[0]).trim() : '';

                    // Step 1: Find Job Start
                    if (firstCell === 'START OF NEW JOB') {
                        inJobBlock = true;
                        currentManager = '';
                        currentAddress = '';
                        dateRow = [];
                        dateRowIndex = -1;
                        addressLines = [];
                        
                        // Step 2 & 3: Get Manager Name
                        // Header is at i+1, Name is at i+2, in cell B (index 1)
                        if (json[i + 2] && json[i + 2][1]) {
                           currentManager = String(json[i + 2][1]).trim();
                        }
                        continue;
                    }

                    if (!inJobBlock) continue;
                    
                    // Step 4: Get Site Address
                    if (firstCell === 'ADDRESS') {
                       // Address starts in the row below this header
                       let j = i + 1;
                       while(j < json.length && json[j] && (json[j][5] === null || json[j][5] === undefined) ) {
                           const addressCell = json[j][0] ? String(json[j][0]).trim() : '';
                           if(addressCell) {
                               addressLines.push(addressCell);
                           }
                           j++;
                       }
                       currentAddress = addressLines.join(', ');
                    }

                    // Step 5: Find Date Row
                    if (row.some(cell => cell && /^\d{1,2}-[A-Za-z]{3}$/.test(String(cell)))) {
                        dateRow = row;
                        dateRowIndex = i;
                    }

                    // Step 6 & 7: Parse Shift Grid
                    if (dateRow.length > 0 && i > dateRowIndex) {
                        if (firstCell === 'END OF THIS JOB') {
                            inJobBlock = false; // End of current job
                            continue;
                        }

                        // This is a shift row
                        for (let j = 5; j < row.length; j++) { // Dates start at column F (index 5)
                            const shiftCell = row[j] ? String(row[j]).trim() : null;
                            const dateValue = dateRow[j];
                            
                            if (!shiftCell || !dateValue) continue;

                            const [taskText, userText] = shiftCell.split('-').map(s => s.trim());

                            if (!taskText || !userText) {
                                failedShifts.push({ userText: userText || 'N/A', taskText: taskText || 'N/A', date: String(dateValue), row: i + 1, reason: 'Invalid format. Expected "Task - User".' });
                                continue;
                            }

                            const user = findUserByName(userText, allUsers);
                            if (!user) {
                                failedShifts.push({ userText, taskText, date: String(dateValue), row: i + 1, reason: `User '${userText}' not found in the database.` });
                                continue;
                            }

                            // Convert Excel date serial number to JS Date
                            const jsDate = XLSX.SSF.parse_date_code(Number(dateValue));
                            const shiftDate = new Date(jsDate.y, jsDate.m - 1, jsDate.d);
                             // Correct for timezone offset by creating a UTC date from the local date parts
                            const correctedDate = new Date(Date.UTC(shiftDate.getFullYear(), shiftDate.getMonth(), shiftDate.getDate()));


                            parsedShifts.push({
                                userId: user.uid,
                                userName: user.name,
                                date: Timestamp.fromDate(correctedDate),
                                type: 'all-day',
                                status: 'pending-confirmation',
                                address: currentAddress,
                                task: taskText,
                                manager: currentManager,
                                createdAt: serverTimestamp(),
                            });
                        }
                    }
                }
            }

            if (!isDryRun) {
                if(parsedShifts.length > 0) {
                    const batch = writeBatch(db);
                    parsedShifts.forEach(shift => {
                        const newShiftRef = collection(db, 'shifts');
                        batch.set(doc(newShiftRef), shift);
                    });
                    await batch.commit();
                    toast({ title: "Import Successful", description: `${parsedShifts.length} shifts have been added.` });
                } else {
                    toast({ title: "No new shifts to import", variant: "default" });
                }
            }
            
            onImportComplete(failedShifts, isDryRun ? { add: parsedShifts, update: [], delete: [] } : undefined);
            
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
        <Alert>
            <Check className="h-4 w-4" />
            <AlertTitle>{isDryRun ? "Dry Run Mode" : "Live Import Mode"}</AlertTitle>
            <AlertDescription>
                {isDryRun 
                    ? "Dry Run is active. No changes will be saved to the database. The system will only show what would be added."
                    : "Live Import is active. Changes will be saved to the database immediately."
                }
            </AlertDescription>
        </Alert>
      </div>
    </div>
  );
}

    