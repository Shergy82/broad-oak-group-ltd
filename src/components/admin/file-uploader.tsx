'use client';

import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, writeBatch, doc, getDocs, query, where, Timestamp, serverTimestamp, deleteDoc } from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/shared/spinner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Upload, FileWarning, TestTube2, Sheet, XCircle } from 'lucide-react';
import type { Shift, UserProfile, ShiftStatus } from '@/types';
import { Checkbox } from '../ui/checkbox';
import { Label } from '../ui/label';
import { Switch } from '@/components/ui/switch';
import { useAllUsers } from '@/hooks/use-all-users';

export type ParsedShift = Omit<Shift, 'id' | 'status' | 'date' | 'createdAt'> & { date: Date };
type UserMapEntry = { uid: string; normalizedName: string; originalName: string; };

export interface FailedShift {
    date: Date | null;
    projectAddress: string;
    cellContent: string;
    reason: string;
    sheetName: string;
}

interface ReconciliationResult {
  toCreate: ParsedShift[];
  toUpdate: { id: string; data: Partial<Shift> }[];
  toDelete: string[];
  failed: FailedShift[];
}

interface FileUploaderProps {
    onImportComplete: (failedShifts: FailedShift[], dryRunResult?: ReconciliationResult) => void;
    onFileSelect: () => void;
    shiftsToPublish?: ReconciliationResult | null;
    children?: React.ReactNode;
}


// --- Helper Functions ---
const levenshtein = (a: string, b: string): number => {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }
    return matrix[b.length][a.length];
};

const normalizeText = (text: string) => (text || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();

const findUser = (name: string, userMap: UserMapEntry[]): UserMapEntry | null => {
    const normalizedName = normalizeText(name);
    if (!normalizedName) return null;

    let bestMatch: UserMapEntry | null = null;
    let minDistance = Infinity;

    for (const user of userMap) {
        const userNormalized = user.normalizedName;
        // Exact match
        if (userNormalized === normalizedName) return user;
        
        // Check for first name match
        const firstNameNormalized = userNormalized.split(' ')[0];
        if (firstNameNormalized === normalizedName) {
            return user;
        }

        const distance = levenshtein(normalizedName, userNormalized);

        // Prioritize very close matches
        if (distance <= 2 && distance < minDistance) {
            minDistance = distance;
            bestMatch = user;
        }
    }
    
    // Return best match if it's reasonably close
    if (bestMatch && minDistance <= 3) {
        return bestMatch;
    }

    return null;
}

const parseDate = (dateValue: any): Date | null => {
    if (!dateValue) return null;
    if (dateValue instanceof Date && !isNaN(dateValue.getTime())) {
        return new Date(Date.UTC(dateValue.getFullYear(), dateValue.getMonth(), dateValue.getDate()));
    }
    if (typeof dateValue === 'number' && dateValue > 1) { // Excel serial date
        // Excel's epoch starts on 1900-01-01, but incorrectly thinks 1900 is a leap year.
        // The convention is to treat dates as if the epoch was 1899-12-30.
        const excelEpoch = new Date(1899, 11, 30);
        const d = new Date(excelEpoch.getTime() + dateValue * 86400000);
        if (!isNaN(d.getTime())) {
             return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
        }
    }
    if (typeof dateValue === 'string') {
        // Try parsing formats like "dd/mm/yyyy" or "dd-Mon-yyyy"
        const d = new Date(dateValue);
        if (!isNaN(d.getTime())) {
             return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
        }
    }
    return null;
};


const getShiftKey = (shift: { userId: string; date: Date | Timestamp; task: string; address: string }): string => {
    let datePart: string;

    if (shift.date instanceof Timestamp) {
        const d = shift.date.toDate();
        // Use UTC date parts to ensure consistency regardless of server/client timezone
        datePart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString().slice(0, 10);
    } else { // It's a JS Date object
        datePart = new Date(Date.UTC(shift.date.getFullYear(), shift.date.getMonth(), shift.date.getDate())).toISOString().slice(0, 10);
    }

    const cleanTask = normalizeText(shift.task);
    const cleanAddress = normalizeText(shift.address);

    return `${datePart}-${shift.userId}-${cleanAddress}-${cleanTask}`;
};
  
export function FileUploader({ onImportComplete, onFileSelect, shiftsToPublish, children }: FileUploaderProps) {
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDryRun, setIsDryRun] = useState(true);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [enabledSheets, setEnabledSheets] = useState<{ [key: string]: boolean }>({});
  const { toast } = useToast();
  const { users } = useAllUsers();

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
            setSheetNames(workbook.SheetNames);
            const initialEnabled: { [key: string]: boolean } = {};
            workbook.SheetNames.forEach(name => {
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
  
  const processAndPublish = async (reconciliationResult: ReconciliationResult) => {
      setIsProcessing(true);
      const { toCreate, toUpdate, toDelete } = reconciliationResult;

      if (toCreate.length === 0 && toUpdate.length === 0 && toDelete.length === 0) {
          toast({ title: 'No Changes', description: "The schedule was already up-to-date." });
          onImportComplete(reconciliationResult.failed);
          setIsProcessing(false);
          return;
      }

      try {
        const batch = writeBatch(db);
        
        toCreate.forEach(excelShift => {
            const newShiftData = {
                ...excelShift,
                date: Timestamp.fromDate(excelShift.date),
                status: 'pending-confirmation',
                createdAt: serverTimestamp(),
            };
            batch.set(doc(collection(db, 'shifts')), newShiftData);
        });

        toUpdate.forEach(update => {
            batch.update(doc(db, 'shifts', update.id), update.data);
        });

        toDelete.forEach(shiftId => {
            batch.delete(doc(db, 'shifts', shiftId));
        });
        
        await batch.commit();

        let descriptionParts = [];
        if (toCreate.length > 0) descriptionParts.push(`created ${toCreate.length}`);
        if (toUpdate.length > 0) descriptionParts.push(`updated ${toUpdate.length}`);
        if (toDelete.length > 0) descriptionParts.push(`deleted ${toDelete.length}`);
        
        toast({
            title: 'Import Complete & Reconciled',
            description: `Successfully ${descriptionParts.join(', ')} shift(s).`,
        });
        
        onImportComplete(reconciliationResult.failed);
        setFile(null);
        const fileInput = document.getElementById('shift-file-input') as HTMLInputElement;
        if (fileInput) fileInput.value = "";
        setSheetNames([]);
        setEnabledSheets({});

      } catch (err: any) {
        console.error('Publishing failed:', err);
        setError(err.message || 'An unexpected error occurred during publishing.');
        onImportComplete(reconciliationResult.failed, reconciliationResult);
      } finally {
        setIsProcessing(false);
      }
  };

  const handleProcessFile = async () => {
    if (shiftsToPublish) {
        await processAndPublish(shiftsToPublish);
        return;
    }
      
    if (!file || !db) {
      setError('Please select a file first.');
      return;
    }
    const sheetsToProcess = sheetNames.filter(name => enabledSheets[name]);
    if (sheetsToProcess.length === 0) {
        setError('No sheets selected. Please enable at least one sheet to import.');
        return;
    }

    setIsProcessing(true);
    setError(null);
    onImportComplete([], { toCreate: [], toUpdate: [], toDelete: [], failed: [] });

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = e.target?.result;
        if (!data) throw new Error("Could not read file data.");
        
        const workbook = XLSX.read(data, { type: 'array' });

        const userMap: UserMapEntry[] = users.map(user => ({
            uid: user.uid,
            normalizedName: normalizeText(user.name),
            originalName: user.name,
        }));
        
        let allParsedShifts: ParsedShift[] = [];
        let allFailedShifts: FailedShift[] = [];
        
        for (const sheetName of sheetsToProcess) {
            const worksheet = workbook.Sheets[sheetName];
            if (!worksheet) continue;

            const jsonData = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1, blankrows: false, defval: null });
            
            const projectBlockStartRows: number[] = [];
            jsonData.forEach((row, i) => {
                if (String(row[0]).trim().toUpperCase() === 'JOB MANAGER') {
                    projectBlockStartRows.push(i);
                }
            });
            
            if (projectBlockStartRows.length === 0) continue;

            for (let i = 0; i < projectBlockStartRows.length; i++) {
                const blockStartRow = projectBlockStartRows[i];
                const blockEndRow = i + 1 < projectBlockStartRows.length ? projectBlockStartRows[i+1] : jsonData.length;
                
                const manager = String(jsonData[blockStartRow + 2]?.[0] || 'Unknown Manager').trim();
                
                let address = '';
                let addressStartRow = -1;
                for (let r = blockStartRow; r < blockEndRow; r++) {
                    if (String(jsonData[r]?.[0]).trim().toUpperCase() === 'SITE ADDRESS') {
                        addressStartRow = r + 1;
                        break;
                    }
                }

                if (addressStartRow > -1) {
                    let addressLines = [];
                    for (let r = addressStartRow; r < blockEndRow; r++) {
                        const line = String(jsonData[r]?.[0] || '').trim();
                        if (!line || String(jsonData[r+1]?.[0]).trim().toUpperCase() === 'JOB MANAGER' || r === blockEndRow -1) {
                            if (line) addressLines.push(line);
                            break;
                        }
                        addressLines.push(line);
                    }
                    address = addressLines.join(', ');
                }

                if (!address) {
                     allFailedShifts.push({ date: null, projectAddress: `Block at row ${blockStartRow + 1}`, cellContent: '', reason: 'Could not find Address.', sheetName });
                     continue;
                }

                let dateRow: (Date | null)[] = [];
                let dateRowIndex = -1;
                for (let r = blockStartRow; r < blockEndRow; r++) {
                    const row = jsonData[r];
                    if (!row) continue;
                    let dateCount = 0;
                    for (let c = 5; c < row.length; c++) { // Start from column F (index 5)
                        if (row[c] !== null && parseDate(row[c])) {
                            dateCount++;
                        }
                    }
                    if (dateCount > 2) { // Heuristic for date row
                        dateRowIndex = r;
                        dateRow = row.map((cell, c) => c >= 5 ? parseDate(cell) : null);
                        break;
                    }
                }
                
                if (dateRowIndex === -1) {
                    allFailedShifts.push({ date: null, projectAddress: address, cellContent: '', reason: 'Could not find Date Row.', sheetName });
                    continue;
                }
                
                for (let r = dateRowIndex + 1; r < blockEndRow; r++) {
                    const rowData = jsonData[r];
                    if (!rowData || rowData[0] === null) continue; // Skip empty rows

                    for (let c = 5; c < Math.min(rowData.length, dateRow.length); c++) { 
                        const shiftDate = dateRow[c];
                        if (!shiftDate) continue;

                        const cellContentRaw = String(rowData[c] || '').trim();
                        if (!cellContentRaw) continue;
                        
                        const cellContentCleaned = cellContentRaw.replace(/ *\([^)]*\) */g, "").trim();
                        const parts = cellContentCleaned.split('-').map(p => p.trim());

                        if (parts.length < 2) continue;
                        
                        const taskDescription = parts[0];
                        const userName = parts.slice(1).join('-').trim();

                        if (taskDescription && userName) {
                            const user = findUser(userName, userMap);
                            if (user) {
                                allParsedShifts.push({ 
                                    task: taskDescription, 
                                    userId: user.uid, 
                                    userName: user.originalName,
                                    type: 'all-day',
                                    date: shiftDate, 
                                    address, 
                                    bNumber: '',
                                    manager,
                                });
                            } else {
                                allFailedShifts.push({
                                    date: shiftDate,
                                    projectAddress: address,
                                    cellContent: cellContentRaw,
                                    reason: `Could not find user matching "${userName}".`,
                                    sheetName
                                });
                            }
                        }
                    }
                }
            }
        }
        
        const allDatesFound = allParsedShifts.map(s => s.date).filter((d): d is Date => d !== null);
        if (allDatesFound.length === 0 && allFailedShifts.length > 0) {
            onImportComplete(allFailedShifts, { toCreate: [], toUpdate: [], toDelete: [], failed: allFailedShifts });
            setIsProcessing(false);
            return;
        }

        const minDate = new Date(Math.min(...allDatesFound.map(d => d.getTime())));
        const maxDate = new Date(Math.max(...allDatesFound.map(d => d.getTime())));

        const shiftsQuery = query(
            collection(db, 'shifts'),
            where('date', '>=', Timestamp.fromDate(minDate)),
            where('date', '<=', Timestamp.fromDate(maxDate))
        );
        const existingShiftsSnapshot = await getDocs(shiftsQuery);

        const existingShiftsMap = new Map<string, Shift>();
        existingShiftsSnapshot.forEach(doc => {
            const shiftData = { id: doc.id, ...doc.data() } as Shift;
            existingShiftsMap.set(getShiftKey(shiftData), shiftData);
        });
        
        const parsedShiftsMap = new Map<string, ParsedShift>();
        allParsedShifts.forEach(shift => {
             const key = getShiftKey(shift);
             if (!parsedShiftsMap.has(key)) { // Avoid duplicates from the file itself
                parsedShiftsMap.set(key, shift);
             }
        });

        const toCreate: ParsedShift[] = [];
        parsedShiftsMap.forEach((parsedShift, key) => {
            if (!existingShiftsMap.has(key)) {
                toCreate.push(parsedShift);
            }
        });

        const toUpdate: { id: string; data: Partial<Shift> }[] = [];
        const toDelete: string[] = [];
        const protectedStatuses: ShiftStatus[] = ['completed', 'incomplete', 'on-site'];
        
        existingShiftsMap.forEach((dbShift, key) => {
            const excelShift = parsedShiftsMap.get(key);
            if (excelShift) {
                // This shift exists in both. Check for updates.
                const updateData: Partial<Shift> = {};
                if (dbShift.manager !== excelShift.manager) updateData.manager = excelShift.manager;
                if (dbShift.bNumber !== excelShift.bNumber) updateData.bNumber = excelShift.bNumber;
                
                if (Object.keys(updateData).length > 0 && !protectedStatuses.includes(dbShift.status)) {
                    toUpdate.push({ id: dbShift.id, data: updateData });
                }
            } else {
                // This shift is in the DB but not in the Excel file. Mark for deletion.
                if(!protectedStatuses.includes(dbShift.status)){
                   toDelete.push(dbShift.id);
                }
            }
        });
        
        const reconciliationResult: ReconciliationResult = { toCreate, toUpdate, toDelete, failed: allFailedShifts };
        
        if (isDryRun) {
            onImportComplete(allFailedShifts, reconciliationResult);
        } else {
            await processAndPublish(reconciliationResult);
        }

      } catch (err: any) {
        console.error('Import failed:', err);
        setError(err.message || 'An unexpected error occurred during import.');
        onImportComplete([], { toCreate: [], toUpdate: [], toDelete: [], failed: [] });
      } finally {
        setIsProcessing(false);
      }
    };

    reader.onerror = () => {
        setError('Failed to read the file.');
        setIsProcessing(false);
    }

    reader.readAsArrayBuffer(file);
  };
  
  if (shiftsToPublish) {
    return <div onClick={handleProcessFile}>{children}</div>;
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
                                checked={enabledSheets[name]}
                                onCheckedChange={(checked) => toggleSheet(name, checked)}
                            />
                        </div>
                    ))}
                </div>
            </div>
        )}

        <div className="flex flex-col sm:flex-row gap-4 items-center">
            <div className="flex items-center space-x-2">
                <Checkbox id="dry-run" checked={isDryRun} onCheckedChange={(checked) => setIsDryRun(!!checked)} />
                <Label htmlFor="dry-run" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                    Dry Run (Preview changes before publishing)
                </Label>
            </div>
            <Button onClick={handleProcessFile} disabled={!file || isProcessing} className="w-full sm:w-auto ml-auto">
              {isProcessing ? <Spinner /> : isDryRun ? <><TestTube2 className="mr-2 h-4 w-4" /> Run Test</> : <><Upload className="mr-2 h-4 w-4" /> Import & Publish</>}
            </Button>
        </div>
      </div>
    </div>
  );
}
    

    