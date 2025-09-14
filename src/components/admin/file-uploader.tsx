
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
        
        if (user.normalizedName.includes(normalizedName) || (firstNameNormalized && firstNameNormalized.includes(normalizedName))) {
            if (distance < minDistance) {
                minDistance = distance;
                bestMatch = user;
            }
        }
        
        const threshold = Math.max(1, Math.floor(normalizedName.length / 4));
        if (distance <= threshold && distance < minDistance) {
            minDistance = distance;
            bestMatch = user;
        }
    }
    
    if (bestMatch && minDistance < 3) {
            return bestMatch;
    }

    return null;
}

const parseDate = (dateValue: any): Date | null => {
    if (!dateValue) return null;
    if (dateValue instanceof Date) {
        const d = dateValue;
        return !isNaN(d.getTime()) ? new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) : null;
    }
    if (typeof dateValue === 'number' && dateValue > 1) {
        const d = new Date(Math.round((dateValue - 25569) * 864e5));
        return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    }
    if (typeof dateValue === 'string') {
        const parts = dateValue.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
        if (parts) {
            const day = parseInt(parts[1], 10);
            const month = parseInt(parts[2], 10) - 1;
            const year = parseInt(parts[3], 10);
            if (year > 1900 && month >= 0 && month < 12 && day > 0 && day <= 31) {
                return new Date(Date.UTC(year, month, day));
            }
        }
    }
    return null;
};

const isLikelyAddress = (str: string): boolean => {
    if (!str || typeof str !== 'string' || str.length < 5) return false;
    const lowerCaseStr = str.toLowerCase();
    const excludedKeywords = ['week commencing', 'project address', 'job address', 'information:', 'house:'];
    if (excludedKeywords.some(keyword => lowerCaseStr.startsWith(keyword))) {
        return false;
    }
    if (lowerCaseStr.includes('completion date')) {
        return false;
    }
    if (!/\d/.test(str) || !/[a-zA-Z]/.test(str)) return false;
    if (str.trim().split(/\s+/).length < 2) return false;
    return true;
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
    // Using a more robust key to uniquely identify a shift based on its core properties
    return `${normalizedDate.toISOString().slice(0, 10)}-${shift.userId}-${shift.type}-${shift.address.trim().toLowerCase()}`;
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
        
        const workbook = XLSX.read(data, { type: 'array' });
        
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

        // --- Process Each Sheet ---
        for (const sheetName of workbook.SheetNames) {
            const worksheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1, blankrows: false, defval: '' });
            
            // --- Sheet-Specific Date Row Identification ---
            let dateRow: any[] = [];
            let dateRowIndex = -1;
            let sheetDates: (Date | null)[] = [];

            for (let i = 0; i < jsonData.length; i++) {
                const row = jsonData[i] || [];
                if (row.length > 2) {
                    const potentialDates = row.slice(2).map(parseDate);
                    const validDateCount = potentialDates.filter(d => d !== null).length;
                    if (validDateCount >= 3) { // Requires at least 3 valid dates
                        dateRow = row;
                        dateRowIndex = i;
                        sheetDates = row.map(parseDate);
                        break;
                    }
                }
            }
            if (dateRowIndex === -1) {
                console.log(`Skipping sheet "${sheetName}" because no valid date row was found.`);
                continue; // Skip this sheet if no date row is found
            }
            
            sheetDates.forEach(d => { if (d) allDatesFound.push(d); });
        
            let currentProjectAddress = '';
            let currentBNumber = '';
            
            for (let r = dateRowIndex + 1; r < jsonData.length; r++) {
                const rowData = jsonData[r] || [];
                if (!rowData.some(cell => cell.toString().trim() !== '')) continue;
                
                const addressCandidate = (rowData[0] || '').toString().trim();
                if (isLikelyAddress(addressCandidate)) {
                    currentProjectAddress = addressCandidate;
                    currentBNumber = (rowData[1] || '').toString().trim();
                }

                if (!currentProjectAddress) continue;

                for (let c = 2; c < rowData.length; c++) {
                    const shiftDate = sheetDates[c];
                    if (!shiftDate) continue; // Skip if there's no date for this column
                    
                    const cellValue = (rowData[c] || '').toString().replace(/\r?\n|\r/g, " ").trim().replace(/[\u2012\u2013\u2014\u2015]/g, '-');
                    
                    if (!cellValue || cellValue.toLowerCase().includes('holiday') || cellValue.toLowerCase().includes('on hold') || cellValue.includes('(') || cellValue.includes(')')) {
                        continue;
                    }

                    // Strict check for "Task - Name" format
                    const parts = cellValue.split('-').map(p => p.trim());
                    if (parts.length < 2) continue;

                    const namePart = parts.pop()!;
                    let task = parts.join('-').trim();
                    
                    const nameCandidates = namePart.split(/[/&+,]/).map(name => name.trim()).filter(Boolean);

                    for (const nameCandidate of nameCandidates) {
                        if (!nameCandidate) continue;

                        const foundUser = findUser(nameCandidate, userMap);
                        
                        if (foundUser) {
                            let type: 'am' | 'pm' | 'all-day' = 'all-day';
                            let processedTask = task;
                            const amPmMatch = task.match(/\b(AM|PM)\b/i);
                            if (amPmMatch) {
                                type = amPmMatch[0].toLowerCase() as 'am' | 'pm';
                                processedTask = task.replace(new RegExp(`\\s*\\b${amPmMatch[0]}\\b`, 'i'), '').trim();
                            }
                            shiftsFromExcel.push({ task: processedTask, userId: foundUser.uid, type, date: shiftDate, address: currentProjectAddress, bNumber: currentBNumber });
                        } else {
                             if (shiftDate >= today) {
                                failedShifts.push({
                                    date: shiftDate,
                                    projectAddress: currentProjectAddress,
                                    cellContent: cellValue,
                                    reason: `Unrecognized Operative: "${nameCandidate}".`
                                });
                             }
                        }
                    }
                }
            }
        }
        
        if (allDatesFound.length === 0) {
            throw new Error("No valid shifts found in any sheet. Please ensure at least one sheet has a valid date row and shift data.");
        }

        const minDate = new Date(Math.min(...allDatesFound.map(d => d.getTime())));
        const maxDate = new Date(Math.max(...allDatesFound.map(d => d.getTime())));

        // --- RECONCILIATION LOGIC ---
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

        // Process Excel shifts: Add new or update existing
        for (const [key, excelShift] of excelShiftsMap.entries()) {
            const existingShift = existingShiftsMap.get(key);

            if (existingShift) {
                // It exists, check if it needs an update
                if (existingShift.task !== excelShift.task || existingShift.bNumber !== (excelShift.bNumber || '')) {
                     if (!protectedStatuses.includes(existingShift.status)) {
                        batch.update(doc(db, 'shifts', existingShift.id), { task: excelShift.task, bNumber: excelShift.bNumber || '' });
                        shiftsUpdated++;
                     }
                }
                // Remove from map so we know it's been handled
                existingShiftsMap.delete(key);
            } else {
                // It's a new shift, add it
                const newShiftData = {
                    ...excelShift,
                    date: Timestamp.fromDate(excelShift.date),
                    status: 'confirmed', // Create as confirmed
                    isNew: true, // Flag for user acknowledgement
                    createdAt: serverTimestamp(),
                };
                batch.set(doc(collection(db, 'shifts')), newShiftData);
                shiftsCreated++;
            }
        }

        // Process remaining shifts in existingShiftsMap: these need to be deleted
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
            onImportComplete([]); // Explicitly send empty array on success
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
