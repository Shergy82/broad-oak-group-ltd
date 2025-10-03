
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
import { Upload, FileWarning, CheckCircle, TestTube2 } from 'lucide-react';
import type { Shift, UserProfile, ShiftStatus } from '@/types';
import { Checkbox } from '../ui/checkbox';
import { Label } from '../ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { format } from 'date-fns';

type ParsedShift = Omit<Shift, 'id' | 'status' | 'date' | 'createdAt'> & { date: Date };
type UserMapEntry = { uid: string; normalizedName: string; originalName: string; };

export interface FailedShift {
    date: Date | null;
    projectAddress: string;
    cellContent: string;
    reason: string;
}

interface DryRunResult {
    found: ParsedShift[];
    failed: FailedShift[];
}

interface FileUploaderProps {
    onImportComplete: (failedShifts: FailedShift[], dryRunResult?: DryRunResult) => void;
    onFileSelect: () => void;
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

const normalizeText = (text: string) => (text || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const findUser = (name: string, userMap: UserMapEntry[]): UserMapEntry | null => {
    const normalizedName = normalizeText(name);
    if (!normalizedName) return null;

    let bestMatch: UserMapEntry | null = null;
    let minDistance = Infinity;

    for (const user of userMap) {
        // Direct match is best
        if (user.normalizedName === normalizedName) return user;
        
        // Full name contains the search term (e.g., "rory" in "roryskinner")
        if (user.normalizedName.includes(normalizedName)) {
            const distance = levenshtein(normalizedName, user.normalizedName);
             if (distance < minDistance) {
                minDistance = distance;
                bestMatch = user;
            }
        }

        // Check first name match
        const firstNameNormalized = normalizeText(user.originalName.split(' ')[0]);
        if (firstNameNormalized === normalizedName) {
            return user;
        }

        // Levenshtein distance for typo tolerance
        const distance = levenshtein(normalizedName, user.normalizedName);
        const threshold = Math.max(1, Math.floor(normalizedName.length / 4));
        if (distance <= threshold && distance < minDistance) {
            minDistance = distance;
            bestMatch = user;
        }
    }
    
    // Only return a fuzzy match if it's reasonably close
    if (bestMatch && minDistance <= 2) {
        return bestMatch;
    }

    return null;
}

const parseDate = (dateValue: any): Date | null => {
    if (!dateValue) return null;
    if (dateValue instanceof Date && !isNaN(dateValue.getTime())) {
        return new Date(Date.UTC(dateValue.getFullYear(), dateValue.getMonth(), dateValue.getDate()));
    }
    if (typeof dateValue === 'number' && dateValue > 1) {
        const excelEpoch = new Date(1899, 11, 30);
        const d = new Date(excelEpoch.getTime() + dateValue * 24 * 60 * 60 * 1000);
        if (!isNaN(d.getTime())) {
             return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
        }
    }
    if (typeof dateValue === 'string') {
        const dateMatch = dateValue.match(/(\d{1,2})[ -]+([A-Za-z]+)/);
        if (dateMatch) {
            const day = parseInt(dateMatch[1], 10);
            const monthStr = dateMatch[2];
            const monthIndex = new Date(Date.parse(monthStr +" 1, 2012")).getMonth();
            if (!isNaN(day) && monthIndex !== -1) {
                 const year = new Date().getFullYear();
                 return new Date(Date.UTC(year, monthIndex, day));
            }
        }
        const parts = dateValue.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4}|\d{2})$/);
        if (parts) {
            let year = parseInt(parts[3], 10);
            if (year < 100) year += 2000;
            const month = parseInt(parts[2], 10) - 1;
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
  const [isDryRun, setIsDryRun] = useState(true);
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
        const userMap: UserMapEntry[] = usersSnapshot.docs.map(doc => {
            const user = doc.data() as UserProfile;
            return {
                uid: doc.id,
                normalizedName: normalizeText(user.name),
                originalName: user.name,
            };
        });
        
        const shiftsFromExcel: ParsedShift[] = [];
        const failedShifts: FailedShift[] = [];
        const allDatesFound: Date[] = [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        for (const sheetName of workbook.SheetNames) {
            const worksheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1, blankrows: false, defval: null });

            let dateRowIndex = -1;
            let dateRow: (Date | null)[] = [];
            for (let i = 0; i < Math.min(jsonData.length, 10); i++) {
                const row = jsonData[i] || [];
                const validDateCount = row.slice(4).filter(cell => cell && parseDate(cell) !== null).length;
                if (validDateCount > 2) { 
                    dateRowIndex = i;
                    dateRow = row.map(parseDate);
                    dateRow.forEach(d => d && allDatesFound.push(d));
                    break;
                }
            }
            if (dateRowIndex === -1) continue;
            
            const projectBlockStarts: number[] = [];
            jsonData.forEach((row, i) => {
                const cellA = (row[0] || '').toString().toUpperCase();
                if (cellA.includes('JOB MANAGER')) projectBlockStarts.push(i);
            });

            for (let i = 0; i < projectBlockStarts.length; i++) {
                const blockStart = projectBlockStarts[i];
                const blockEnd = i + 1 < projectBlockStarts.length ? projectBlockStarts[i+1] : jsonData.length;
                
                const manager = (jsonData[blockStart + 1]?.[0] || '').toString().trim();
                let address = '';
                let bNumber = '';
                
                for (let r = blockStart; r < blockEnd; r++) {
                    const cellValue = jsonData[r]?.[0];
                    if (cellValue && typeof cellValue === 'string' && cellValue.includes('\n')) {
                        const parts = cellValue.split('\n');
                        bNumber = parts[0].trim().length < 15 ? parts[0].trim() : '';
                        address = (bNumber ? parts.slice(1) : parts).join(', ').trim();
                        break;
                    }
                }
                if (!address) continue;

                for (let c = 4; c < dateRow.length; c++) {
                    const shiftDate = dateRow[c];
                    if (!shiftDate) continue;

                    for (let r = blockStart; r < blockEnd; r++) {
                        const cell = worksheet[XLSX.utils.encode_cell({c, r})];
                        const cellContentRaw = cell?.v;
                        if (!cellContentRaw || typeof cellContentRaw !== 'string') continue;
                        
                        const bgColor = cell?.s?.fgColor?.rgb;
                        if (bgColor === 'FF800080' || bgColor === '800080') { // Deep Purple
                            continue;
                        }

                        const cellContent = cellContentRaw.replace(/\s+/g, ' ').trim();
                        const parts = cellContent.split('-').map(p => p.trim());
                        
                        if (parts.length > 1) {
                            const potentialUserNames = parts.pop()!;
                            const task = parts.join('-').trim();
                            
                            const usersInCell = potentialUserNames.split(/&|,/g).map(name => name.trim()).filter(Boolean);

                            if (task && usersInCell.length > 0) {
                                let usersFound = 0;
                                for (const userName of usersInCell) {
                                    const user = findUser(userName, userMap);
                                    if (user) {
                                        usersFound++;
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
                                        failedShifts.push({
                                            date: shiftDate,
                                            projectAddress: address,
                                            cellContent: cellContentRaw,
                                            reason: `Could not find a user matching "${userName}". Check for typos.`
                                        });
                                    }
                                }
                                if (usersInCell.length > 0 && usersFound === 0 && shiftDate >= today) {
                                     failedShifts.push({
                                        date: shiftDate,
                                        projectAddress: address,
                                        cellContent: cellContentRaw,
                                        reason: `No users found matching "${potentialUserNames}".`
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
        
        if (isDryRun) {
            onImportComplete(failedShifts, { found: shiftsFromExcel, failed: failedShifts });
            setIsUploading(false);
            return;
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

        for (const [key, excelShift] of excelShiftsMap.entries()) {
            const existingShift = existingShiftsMap.get(key);
            if (existingShift) {
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
                existingShiftsMap.delete(key);
            } else {
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
        <div className="flex items-center space-x-2">
            <Checkbox id="dry-run" checked={isDryRun} onCheckedChange={(checked) => setIsDryRun(!!checked)} />
            <Label htmlFor="dry-run" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                Dry Run
            </Label>
        </div>
        <Button onClick={handleImport} disabled={!file || isUploading} className="w-full sm:w-auto">
          {isUploading ? <Spinner /> : isDryRun ? <><TestTube2 className="mr-2 h-4 w-4" /> Run Test</> : <><Upload className="mr-2 h-4 w-4" /> Import Shifts</>}
        </Button>
      </div>
    </div>
  );
}
