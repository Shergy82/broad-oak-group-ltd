
'use client';

import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, writeBatch, doc, getDocs, query, where, Timestamp, serverTimestamp } from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/shared/spinner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Upload } from 'lucide-react';
import type { Shift, UserProfile, ShiftStatus } from '@/types';

type ParsedShift = Omit<Shift, 'id' | 'status' | 'date' | 'createdAt'> & { date: Date };
type UserMapEntry = { uid: string; normalizedName: string; originalName: string; };

export interface FailedShift {
    date: Date | null;
    projectAddress: string;
    cellContent: string;
    reason: string;
}

interface FileUploaderProps {
    onImportComplete: (failedShifts: FailedShift[]) => void;
    onFileSelect: () => void;
}


// --- Helper Functions ---
const levenshtein = (a: string, b: string): number => {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const matrix = [];
    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }
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

const normalizeText = (text: string) => (text || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const findUser = (name: string, userMap: UserMapEntry[]): UserMapEntry | null => {
    const normalizedName = normalizeText(name);
    if (!normalizedName) return null;

    // 1. Exact match on normalized name
    const exactMatch = userMap.find(u => u.normalizedName === normalizedName);
    if (exactMatch) return exactMatch;
    
    // 2. Fuzzy match for nicknames and typos
    let bestMatch: UserMapEntry | null = null;
    let minDistance = Infinity;

    for (const user of userMap) {
        const distance = levenshtein(normalizedName, user.normalizedName);
        const nameParts = user.originalName.split(' ');
        const firstNameNormalized = nameParts.length > 0 ? normalizeText(nameParts[0]) : '';
        
        // Prioritize matches where the input is a substring of the full name or first name
        if (user.normalizedName.includes(normalizedName) || (firstNameNormalized && firstNameNormalized.includes(normalizedName))) {
            if (distance < minDistance) {
                minDistance = distance;
                bestMatch = user;
            }
        }
        
        // General fuzzy match with a threshold
        const threshold = Math.max(1, Math.floor(normalizedName.length / 4));
        if (distance <= threshold && distance < minDistance) {
            minDistance = distance;
            bestMatch = user;
        }
    }
    
    // Be more confident with shorter distances
    if (bestMatch && minDistance < 3) {
            return bestMatch;
    }
    
    // Also try to find the name within the original name, e.g. "Rory" in "Rory Skinner"
     for (const user of userMap) {
        if (normalizeText(user.originalName).includes(normalizedName)) {
            return user;
        }
    }

    return null;
}

const parseDate = (dateValue: any): Date | null => {
    if (!dateValue) return null;
    // XLSX can parse dates as Date objects if cellDates is true
    if (dateValue instanceof Date) {
        const d = dateValue;
        // Check for invalid date
        if (!isNaN(d.getTime())) {
            // Standardize to UTC midnight to avoid timezone issues
            return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
        }
    }
    // Or as numbers (Excel's date serial number)
    if (typeof dateValue === 'number' && dateValue > 1) {
        // Excel's epoch starts on 1899-12-30 for compatibility with Lotus 1-2-3
        const excelEpoch = new Date(1899, 11, 30);
        const d = new Date(excelEpoch.getTime() + dateValue * 24 * 60 * 60 * 1000);
        if (isNaN(d.getTime())) return null;
        return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    }
    // Or as strings
    if (typeof dateValue === 'string') {
        // Try parsing '26-Sep' format
        const dateMatch = dateValue.match(/(\d{1,2})[ -]+([A-Za-z]+)/);
        if (dateMatch) {
            const day = parseInt(dateMatch[1], 10);
            const monthStr = dateMatch[2];
            const monthIndex = new Date(Date.parse(monthStr +" 1, 2012")).getMonth();
            if (!isNaN(day) && monthIndex !== -1) {
                 const year = new Date().getFullYear(); // Assume current year
                 return new Date(Date.UTC(year, monthIndex, day));
            }
        }
        // Try parsing 'dd/mm/yyyy' or 'dd-mm-yy'
        const parts = dateValue.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4}|\d{2})$/);
        if (parts) {
            let year = parseInt(parts[3], 10);
            if (year < 100) {
                year += 2000;
            }
            const month = parseInt(parts[2], 10) - 1; // Month is 0-indexed
            const day = parseInt(parts[1], 10);
            if (year > 1900 && month >= 0 && month < 12 && day > 0 && day <= 31) {
                return new Date(Date.UTC(year, month, day));
            }
        }
    }
    return null;
};


export function FileUploader({ onImportComplete, onFileSelect }: FileUploaderProps) {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      const selectedFile = event.target.files[0];
       if (selectedFile) {
        setFile(selectedFile);
        setError(null);
        onFileSelect();
       }
    }
  };

  const getShiftKey = (shift: { userId: string; date: Date | Timestamp; type: 'am' | 'pm' | 'all-day'; task: string; address: string }): string => {
    const d = (shift.date as any).toDate ? (shift.date as Timestamp).toDate() : (shift.date as Date);
    const normalizedDate = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    return `${normalizedDate.toISOString().slice(0, 10)}-${shift.userId}-${normalizeText(shift.address)}-${normalizeText(shift.task)}`;
  };


  const handleImport = async () => {
    if (!file || !db) {
      setError('Please select a file first.');
      return;
    }

    setIsUploading(true);
    setError(null);
    onImportComplete([]);

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = e.target?.result;
        if (!data) throw new Error("Could not read file data.");
        
        const workbook = XLSX.read(data, { type: 'array', cellDates: true, cellStyles: true });
        
        const usersSnapshot = await getDocs(collection(db, 'users'));
        const userMap: UserMapEntry[] = [];
        usersSnapshot.forEach(doc => {
            const user = doc.data() as UserProfile;
            if (user.name) {
              userMap.push({
                uid: doc.id,
                normalizedName: normalizeText(user.name),
                originalName: user.name,
              });
            }
        });
        
        const shiftsFromExcel: ParsedShift[] = [];
        const failedShifts: FailedShift[] = [];
        const allDatesFound: Date[] = [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        for (const sheetName of workbook.SheetNames) {
            const worksheet = workbook.Sheets[sheetName];
            // Use sheet_to_json with header:1 to get an array of arrays
            const jsonData = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1, blankrows: false, defval: null });

            let dateRowIndex = -1;
            let dateRow: (Date | null)[] = [];

            // 1. Find the date row (e.g., Row 3 in the image)
            for (let i = 0; i < Math.min(jsonData.length, 10); i++) {
                const row = jsonData[i] || [];
                const validDateCount = row.slice(4).filter(cell => cell && parseDate(cell) !== null).length;
                // A row with more than 2 valid dates after column D is likely the date row
                if (validDateCount > 2) { 
                    dateRowIndex = i;
                    dateRow = row.map(parseDate);
                    dateRow.forEach(d => d && allDatesFound.push(d));
                    break;
                }
            }
            if (dateRowIndex === -1) continue; // No date row found in this sheet
            
            // 2. Find project blocks by looking for "JOB MANAGER"
            const projectBlockStarts: number[] = [];
            jsonData.forEach((row, i) => {
                const cellA = (row[0] || '').toString().toUpperCase();
                if (cellA.includes('JOB MANAGER')) {
                    projectBlockStarts.push(i);
                }
            });

            // 3. Process each project block
            for (let i = 0; i < projectBlockStarts.length; i++) {
                const blockStart = projectBlockStarts[i];
                const blockEnd = i + 1 < projectBlockStarts.length ? projectBlockStarts[i+1] : jsonData.length;

                let manager = (jsonData[blockStart + 1]?.[0] || '').toString().trim();
                let address = '';
                let bNumber = '';
                
                // Find address/bNumber within the block
                for (let r = blockStart; r < blockEnd; r++) {
                    const cellValue = jsonData[r]?.[0];
                    if (cellValue && typeof cellValue === 'string' && cellValue.includes('\n')) {
                        const parts = cellValue.split('\n');
                        // Heuristic: B-Number is usually short and at the start
                        if (parts[0].trim().length < 15) {
                            bNumber = parts[0].trim();
                            address = parts.slice(1).join(', ').trim();
                        } else {
                            address = cellValue.replace(/\n/g, ', ').trim();
                        }
                        break;
                    }
                }
                
                if (!address) continue; // Skip block if no address is found

                // 4. Iterate through date columns for this block
                for (let c = 4; c < dateRow.length; c++) { // Start after column D
                    const shiftDate = dateRow[c];
                    if (!shiftDate) continue;

                    // 5. Iterate through rows in the block to find shifts
                    for (let r = blockStart; r < blockEnd; r++) {
                        const cellContentRaw = jsonData[r]?.[c];
                        if (!cellContentRaw || typeof cellContentRaw !== 'string') continue;
                        
                        const cellContent = cellContentRaw.replace(/\s+/g, ' ').trim();

                        // Check for the "Task - User" pattern
                        if (cellContent.includes('-')) {
                            const parts = cellContent.split('-');
                            const potentialUser = parts.pop()?.trim(); // Get the last part as user
                            const task = parts.join('-').trim(); // Join the rest as task
                            
                            if (potentialUser && task) {
                                const user = findUser(potentialUser, userMap);
                                
                                if (user) {
                                     let type: 'am' | 'pm' | 'all-day' = 'all-day';
                                     let processedTask = task.toUpperCase();
                                     const amPmMatch = task.match(/\b(AM|PM)\b/i);
                                     if (amPmMatch) {
                                         type = amPmMatch[0].toLowerCase() as 'am' | 'pm';
                                         processedTask = task.replace(new RegExp(`\\s*\\b${amPmMatch[0]}\\b`, 'i'), '').trim();
                                     }
                                     shiftsFromExcel.push({ 
                                         task: processedTask, 
                                         userId: user.uid, 
                                         type, 
                                         date: shiftDate, 
                                         address: address, 
                                         bNumber: bNumber 
                                     });
                                } else if (shiftDate >= today) {
                                    // If we couldn't find a user but the date is in the future, log it as a failure
                                    failedShifts.push({
                                        date: shiftDate,
                                        projectAddress: address,
                                        cellContent: cellContentRaw,
                                        reason: `Could not find a user matching "${potentialUser}". Check for typos.`
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
        
        if (allDatesFound.length === 0) {
            throw new Error("No valid shifts found. Check for a valid date row in the Excel sheet (e.g., in Row 3).");
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

        const excelShiftsMap = new Map<string, ParsedShift>();
        for (const excelShift of shiftsFromExcel) {
          excelShiftsMap.set(getShiftKey(excelShift), excelShift);
        }

        const batch = writeBatch(db);
        let shiftsCreated = 0;
        let shiftsUpdated = 0;
        let shiftsDeleted = 0;

        const protectedStatuses: ShiftStatus[] = ['completed', 'incomplete'];

        // Add or update shifts from Excel
        for (const [key, excelShift] of excelShiftsMap.entries()) {
            const existingShift = existingShiftsMap.get(key);

            if (existingShift) {
                // If shift exists, check for updates (e.g., bNumber, type)
                if (
                    existingShift.bNumber !== (excelShift.bNumber || '') || 
                    existingShift.type !== excelShift.type
                ) {
                     if (!protectedStatuses.includes(existingShift.status)) {
                        batch.update(doc(db, 'shifts', existingShift.id), { 
                            bNumber: excelShift.bNumber || '',
                            type: excelShift.type,
                        });
                        shiftsUpdated++;
                     }
                }
                // Remove from map so it's not considered for deletion
                existingShiftsMap.delete(key);
            } else {
                // If shift does not exist, create it.
                const newShiftData = {
                    ...excelShift,
                    date: Timestamp.fromDate(excelShift.date),
                    status: 'pending-confirmation',
                    createdAt: serverTimestamp(),
                };
                batch.set(doc(collection(db, 'shifts')), newShiftData);
                shiftsCreated++;
            }
        }

        // Delete shifts that are in DB but not in Excel (for the given date range)
        for (const [key, shiftToDelete] of existingShiftsMap.entries()) {
             if (!protectedStatuses.includes(shiftToDelete.status)) {
                batch.delete(doc(db, 'shifts', shiftToDelete.id));
                shiftsDeleted++;
             }
        }
        
        if (shiftsCreated > 0 || shiftsUpdated > 0 || shiftsDeleted > 0) {
            await batch.commit();
        }
        
        let descriptionParts = [];
        if (shiftsCreated > 0) descriptionParts.push(`created ${shiftsCreated} new shift(s)`);
        if (shiftsUpdated > 0) descriptionParts.push(`updated ${shiftsUpdated} shift(s)`);
        if (shiftsDeleted > 0) descriptionParts.push(`deleted ${shiftsDeleted} old shift(s)`);

        if (descriptionParts.length > 0) {
            toast({
                title: 'Import Complete & Reconciled',
                description: `Successfully processed the file: ${descriptionParts.join(', ')}.`,
            });
        } else if (failedShifts.length === 0) {
            toast({
                title: 'No Changes Detected',
                description: "The schedule was up-to-date. No changes were made.",
            });
        }
        
        if (failedShifts.length > 0) {
            onImportComplete(failedShifts);
            toast({
                variant: 'destructive',
                title: `${failedShifts.length} Shift(s) Failed to Import`,
                description: `A report has been generated below with details on the failures.`,
                duration: 10000,
            });
        } else {
            onImportComplete([]);
        }

        setFile(null);
        const fileInput = document.getElementById('shift-file-input') as HTMLInputElement;
        if (fileInput) fileInput.value = "";

      } catch (err: any) {
        console.error('Import failed:', err);
        setError(err.message || 'An unexpected error occurred during import.');
        onImportComplete([]);
      } finally {
        setIsUploading(false);
      }
    };

    reader.onerror = () => {
        setError('Failed to read the file.');
        setIsUploading(false);
    }

    reader.readAsArrayBuffer(file);
  };

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Import Error</AlertTitle>
          <AlertDescription style={{ whiteSpace: 'pre-wrap' }}>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-col sm:flex-row gap-4">
        <Input
          id="shift-file-input"
          type="file"
          accept=".xlsx, .xls"
          onChange={handleFileChange}
          className="flex-grow file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer"
        />
        <Button onClick={handleImport} disabled={!file || isUploading} className="w-full sm:w-40">
          {isUploading ? <Spinner /> : <><Upload className="mr-2 h-4 w-4" /> Import Shifts</>}
        </Button>
      </div>
    </div>
  );
}

    