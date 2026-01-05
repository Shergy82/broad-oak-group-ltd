'use client';

import { useState, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, writeBatch, doc, getDocs, query, where, Timestamp, serverTimestamp } from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/shared/spinner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Upload, FileWarning, TestTube2, Sheet, ChevronDown } from 'lucide-react';
import type { Shift, UserProfile, ShiftStatus } from '@/types';
import { Checkbox } from '../ui/checkbox';
import { Label } from '../ui/label';
import { DropdownMenu, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';


type ParsedShift = Omit<Shift, 'id' | 'status' | 'date' | 'createdAt' | 'userName'> & { date: Date; userName: string; };
type UserMapEntry = { uid: string; normalizedName: string; originalName: string; };

export interface FailedShift {
    date: Date | null;
    projectAddress: string;
    cellContent: string;
    reason: string;
    sheetName: string;
}

export interface DryRunResult {
    toCreate: ParsedShift[];
    toUpdate: { old: Shift, new: ParsedShift }[];
    toDelete: Shift[];
    failed: FailedShift[];
}

interface FileUploaderProps {
    onImportComplete: (failedShifts: FailedShift[], onConfirm: () => Promise<void>, dryRunResult?: DryRunResult) => void;
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
        
        const distance = levenshtein(normalizedName, user.normalizedName);

        // Full name contains the search term (e.g., "rory" in "roryskinner")
        if (user.normalizedName.includes(normalizedName)) {
             if (distance < minDistance) {
                minDistance = distance;
                bestMatch = user;
            }
        }

        // Check first name match
        const firstNameNormalized = normalizeText(user.originalName.split(' ')[0]);
        if (firstNameNormalized === normalizedName) {
             const firstNameDistance = levenshtein(normalizedName, firstNameNormalized);
              if (firstNameDistance < minDistance) {
                minDistance = firstNameDistance;
                bestMatch = user;
            }
        }

        // Levenshtein distance for typo tolerance
        const threshold = Math.max(1, Math.floor(normalizedName.length / 3));
        if (distance <= threshold && distance < minDistance) {
            minDistance = distance;
            bestMatch = user;
        }
    }
    
    // Only return a fuzzy match if it's reasonably close
    if (bestMatch && minDistance <= 3) {
        return bestMatch;
    }

    return null;
}

const parseDate = (dateValue: any): Date | null => {
    if (!dateValue) return null;
    // Handle Excel's numeric date format
    if (typeof dateValue === 'number' && dateValue > 1) {
        const excelEpoch = new Date(1899, 11, 30);
        const d = new Date(excelEpoch.getTime() + dateValue * 24 * 60 * 60 * 1000);
        if (!isNaN(d.getTime())) {
             return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
        }
    }
    // Handle string dates (e.g., "03-Oct" or "03/10/2025")
    if (typeof dateValue === 'string') {
        const lowerCell = dateValue.toLowerCase();
        // Match "dd-Mon" format like "26-Sep"
        const dateMatch = lowerCell.match(/(\d{1,2})[ -/]+([a-z]{3})/);
         if (dateMatch) {
            const day = parseInt(dateMatch[1], 10);
            const monthStr = dateMatch[2];
            const monthIndex = new Date(Date.parse(monthStr +" 1, 2012")).getMonth();
            if (!isNaN(day) && monthIndex !== -1) {
                 const year = new Date().getFullYear();
                 return new Date(Date.UTC(year, monthIndex, day));
            }
        }

        // Match day name format like "Mon 26-Sep"
        const dayNameMatch = lowerCell.match(/(mon|tue|wed|thu|fri|sat|sun)\s+(\d{1,2})[ -/]+([a-z]{3})/);
        if (dayNameMatch) {
            const day = parseInt(dayNameMatch[2], 10);
            const monthStr = dayNameMatch[3];
            const monthIndex = new Date(Date.parse(monthStr +" 1, 2012")).getMonth();
             if (!isNaN(day) && monthIndex !== -1) {
                 const year = new Date().getFullYear();
                 return new Date(Date.UTC(year, monthIndex, day));
            }
        }
    }
     // Handle native JS Date objects
    if (dateValue instanceof Date && !isNaN(dateValue.getTime())) {
        return new Date(Date.UTC(dateValue.getFullYear(), dateValue.getMonth(), dateValue.getDate()));
    }
    return null;
};

const LOCAL_STORAGE_KEY = 'shiftImport_selectedSheets';


export function FileUploader({ onImportComplete, onFileSelect }: FileUploaderProps) {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDryRun, setIsDryRun] = useState(true);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheets, setSelectedSheets] = useState<string[]>([]);
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
            const data = e.target?.result;
            if (!data) return;
            const workbook = XLSX.read(data, { type: 'array', bookSheets: true });
            const allSheets = workbook.SheetNames;
            setSheetNames(allSheets);
            
            // Restore previous selection from localStorage
            try {
                const storedSelection = localStorage.getItem(LOCAL_STORAGE_KEY);
                if (storedSelection) {
                    const parsed = JSON.parse(storedSelection);
                    // Filter to ensure only sheets present in the new file are selected
                    const validStored = parsed.filter((s: string) => allSheets.includes(s));
                    setSelectedSheets(validStored.length > 0 ? validStored : [allSheets[0]]);
                } else {
                    // Default to selecting the first sheet if no preference is stored
                    setSelectedSheets(allSheets.length > 0 ? [allSheets[0]] : []);
                }
            } catch {
                setSelectedSheets(allSheets.length > 0 ? [allSheets[0]] : []);
            }
        };
        reader.readAsArrayBuffer(selectedFile);
       }
    }
  };

  const toggleSheet = (sheetName: string) => {
      const newSelection = selectedSheets.includes(sheetName)
        ? selectedSheets.filter(s => s !== sheetName)
        : [...selectedSheets, sheetName];
      setSelectedSheets(newSelection);
      // Save preference to localStorage
      try {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(newSelection));
      } catch (e) {
          console.warn("Could not save sheet selection to localStorage", e);
      }
  }

  const getShiftKey = (shift: { userId: string; date: Date | Timestamp; task: string; address: string }): string => {
    const d = (shift.date as any).toDate ? (shift.date as Timestamp).toDate() : (shift.date as Date);
    const normalizedDate = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    return `${normalizedDate.toISOString().slice(0, 10)}-${shift.userId}-${normalizeText(shift.address)}-${normalizeText(shift.task)}`;
  };


  const runImport = useCallback(async (commitChanges: boolean) => {
    if (!file || !db) {
      setError('Please select a file first.');
      return;
    }
    
    if (selectedSheets.length === 0) {
        setError('No sheets selected. Please enable at least one sheet to import.');
        return;
    }

    setIsUploading(true);
    setError(null);

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
        
        let allShiftsFromExcel: ParsedShift[] = [];
        let allFailedShifts: FailedShift[] = [];
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        for (const sheetName of selectedSheets) {
            const worksheet = workbook.Sheets[sheetName];
            if (!worksheet) continue;

            const jsonData = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1, blankrows: false, defval: null });

            const projectBlockStartRows: number[] = [];
            jsonData.forEach((row, i) => {
                const cellA = (row[0] || '').toString().trim().toUpperCase();
                if (cellA.includes('JOB MANAGER')) {
                    projectBlockStartRows.push(i);
                }
            });
            
            if (projectBlockStartRows.length === 0) {
                continue; // Skip sheet if no projects found
            }

            for (let i = 0; i < projectBlockStartRows.length; i++) {
                const blockStartRowIndex = projectBlockStartRows[i];
                const blockEndRowIndex = i + 1 < projectBlockStartRows.length ? projectBlockStartRows[i+1] : jsonData.length;
                
                let manager = jsonData[blockStartRowIndex + 1]?.[0] || 'Unknown Manager';
                let address = '';
                let bNumber = '';
                let dateRow: (Date | null)[] = [];
                let dateRowIndex = -1;

                const addressKeywords = ['road', 'street', 'avenue', 'lane', 'drive', 'court', 'close', 'crescent', 'place'];
                for (let r = blockStartRowIndex; r < blockEndRowIndex; r++) {
                    const row = jsonData[r] || [];
                    const cellAValue = row[0];

                    if (!address && cellAValue && typeof cellAValue === 'string') {
                        const lowerCellValue = cellAValue.toLowerCase();
                        if (addressKeywords.some(keyword => lowerCellValue.includes(keyword))) {
                            const parts = cellAValue.split('\n');
                            const firstLine = parts[0].trim();
                            if (firstLine.length < 15 && firstLine.match(/^[a-zA-Z]?\d+/)) {
                                bNumber = firstLine;
                                address = parts.slice(1).join(', ').trim();
                            } else {
                                address = parts.join(', ').trim();
                            }
                        }
                    }
                    
                    if (dateRowIndex === -1) {
                        const dayAbbrs = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
                        const monthAbbrs = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
                        let dateCellCount = 0;
                        row.forEach(cell => {
                            if (cell instanceof Date) dateCellCount++;
                            else if (typeof cell === 'string') {
                                const lowerCell = cell.toLowerCase();
                                if (dayAbbrs.some(day => lowerCell.startsWith(day)) || monthAbbrs.some(abbr => lowerCell.includes(abbr))) {
                                    dateCellCount++;
                                }
                            }
                        });

                        if (dateCellCount > 2) {
                            dateRowIndex = r;
                            dateRow = row.map(cell => parseDate(cell));
                        }
                    }
                }

                if (!address) {
                     allFailedShifts.push({ date: null, projectAddress: `Block at row ${blockStartRowIndex + 1}`, cellContent: '', reason: 'Could not find a valid Address cell in Column A for this project block.', sheetName });
                     continue;
                }
                if (dateRowIndex === -1) {
                    allFailedShifts.push({ date: null, projectAddress: address, cellContent: '', reason: 'Could not find a valid Date Row within this project block.', sheetName });
                    continue;
                }

                for (let r = blockStartRowIndex; r < blockEndRowIndex; r++) {
                    for (let c = 1; c < dateRow.length; c++) { 
                        const shiftDate = dateRow[c];
                        if (!shiftDate) continue;

                        if (shiftDate < today) {
                          continue; // Skip shifts with past dates
                        }

                        const cellRef = XLSX.utils.encode_cell({ r: r, c: c });
                        const cell = worksheet[cellRef];
                        let cellContentRaw = cell?.w || cell?.v;
                        
                        if (!cellContentRaw || typeof cellContentRaw !== 'string') continue;

                        const cellContent = cellContentRaw.replace(/\s+/g, ' ').trim();
                        const bgColor = cell?.s?.fgColor?.rgb;
                        if (bgColor === 'FF800080' || bgColor === '800080') { 
                            continue;
                        }
                        
                        const parts = cellContent.split('-').map(p => p.trim());
                        if (parts.length > 1) {
                            const potentialUserNames = parts.pop()!;
                            const task = parts.join('-').trim();

                            const usersInCell = potentialUserNames.split(/&|,|\+/g).map(name => name.trim()).filter(Boolean);

                            if (task && usersInCell.length > 0) {
                                for (const userName of usersInCell) {
                                    const user = findUser(userName, userMap);
                                    if (user) {
                                        allShiftsFromExcel.push({ 
                                            task: task, 
                                            userId: user.uid, 
                                            userName: user.originalName,
                                            type: 'all-day',
                                            date: shiftDate, 
                                            address: address, 
                                            bNumber: bNumber,
                                            manager: manager,
                                        });
                                    } else {
                                        allFailedShifts.push({
                                            date: shiftDate,
                                            projectAddress: address,
                                            cellContent: cellContentRaw,
                                            reason: `Could not find a user matching "${userName}".`,
                                            sheetName
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        
        if (allShiftsFromExcel.length === 0 && allFailedShifts.length === 0) {
            toast({
                title: 'No Shifts Found',
                description: "The file was processed, but no shifts were found to import from the selected sheets.",
            });
             setIsUploading(false);
            return;
        }

        const allDatesFound = allShiftsFromExcel.map(s => s.date).filter((d): d is Date => d !== null);
        if (allDatesFound.length === 0 && allFailedShifts.length > 0) {
             onImportComplete(allFailedShifts, async () => {}, { toCreate: [], toUpdate: [], toDelete: [], failed: allFailedShifts });
             setIsUploading(false);
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

        const excelShiftsMap = new Map<string, ParsedShift>();
        for (const excelShift of allShiftsFromExcel) {
          excelShiftsMap.set(getShiftKey(excelShift), excelShift);
        }
        
        const toCreate: ParsedShift[] = [];
        const toUpdate: { old: Shift, new: ParsedShift }[] = [];
        const toDelete: Shift[] = [];
        const protectedStatuses: ShiftStatus[] = ['completed', 'incomplete'];

        for (const [key, excelShift] of excelShiftsMap.entries()) {
            const existingShift = existingShiftsMap.get(key);
            if (existingShift) {
                if (
                    existingShift.bNumber !== (excelShift.bNumber || '') || 
                    existingShift.manager !== (excelShift.manager || '')
                ) {
                     if (!protectedStatuses.includes(existingShift.status)) {
                        toUpdate.push({ old: existingShift, new: excelShift });
                     }
                }
            } else {
                toCreate.push(excelShift);
            }
        }

        for (const [key, existingShift] of existingShiftsMap.entries()) {
            if (!excelShiftsMap.has(key) && !protectedStatuses.includes(existingShift.status)) {
                toDelete.push(existingShift);
            }
        }
        
        const onConfirm = async () => {
          const batch = writeBatch(db);

          toCreate.forEach(shift => {
              const newShiftData = {
                  ...shift,
                  date: Timestamp.fromDate(shift.date),
                  status: 'pending-confirmation',
                  createdAt: serverTimestamp(),
              };
              batch.set(doc(collection(db, 'shifts')), newShiftData);
          });

          toUpdate.forEach(({ old, new: newShift }) => {
              batch.update(doc(db, 'shifts', old.id), { 
                  bNumber: newShift.bNumber || '',
                  manager: newShift.manager || '',
              });
          });

          toDelete.forEach(shift => {
              batch.delete(doc(db, 'shifts', shift.id));
          });
          
          if (toCreate.length > 0 || toUpdate.length > 0 || toDelete.length > 0) {
              await batch.commit();
          }
          
          let descriptionParts = [];
          if (toCreate.length > 0) descriptionParts.push(`created ${toCreate.length} new shift(s)`);
          if (toUpdate.length > 0) descriptionParts.push(`updated ${toUpdate.length} shift(s)`);
          if (toDelete.length > 0) descriptionParts.push(`deleted ${toDelete.length} old shift(s)`);

          if (descriptionParts.length > 0) {
              toast({
                  title: 'Import Complete & Reconciled',
                  description: `Successfully processed the file: ${descriptionParts.join(', ')}.`,
              });
          } else if (allFailedShifts.length === 0) {
              toast({
                  title: 'No Changes Detected',
                  description: "The schedule was up-to-date. No changes were made.",
              });
          }
        };

        if (!commitChanges) {
            onImportComplete(allFailedShifts, onConfirm, { toCreate, toUpdate, toDelete, failed: allFailedShifts });
            setIsUploading(false);
            return;
        }

        // This part runs if commitChanges is true (i.e., not a dry run)
        await onConfirm();
        onImportComplete(allFailedShifts, onConfirm);
        
        // Reset file input after successful import
        setFile(null);
        const fileInput = document.getElementById('shift-file-input') as HTMLInputElement;
        if (fileInput) fileInput.value = "";
        setSheetNames([]);
        setSelectedSheets([]);

      } catch (err: any) {
        console.error('Import failed:', err);
        setError(err.message || 'An unexpected error occurred during import.');
        onImportComplete([], async () => {});
      } finally {
        setIsUploading(false);
      }
    };

    reader.onerror = () => {
        setError('Failed to read the file.');
        setIsUploading(false);
    }

    reader.readAsArrayBuffer(file);
  }, [file, selectedSheets, toast]);

  const handleImport = () => {
    runImport(isDryRun === false);
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
          accept=".xlsx, .xls"
          onChange={handleFileChange}
          className="w-full file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer"
        />

        {sheetNames.length > 0 && (
            <div className="space-y-2">
                 <Label htmlFor="sheet-select">Select Sheets to Import</Label>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button id="sheet-select" variant="outline" className="w-full justify-between">
                            <span className="truncate">
                                {selectedSheets.length === 0 
                                    ? 'Select sheets...' 
                                    : selectedSheets.join(', ')}
                            </span>
                            <ChevronDown className="h-4 w-4 opacity-50" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">
                        <DropdownMenuLabel>Available Sheets</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {sheetNames.map(name => (
                             <DropdownMenuCheckboxItem
                                key={name}
                                checked={selectedSheets.includes(name)}
                                onCheckedChange={() => toggleSheet(name)}
                                onSelect={(e) => e.preventDefault()} // prevent menu from closing on item click
                             >
                                <Sheet className="mr-2 h-4 w-4 text-muted-foreground" />
                                {name}
                            </DropdownMenuCheckboxItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        )}

        <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex items-center space-x-2">
                <Checkbox id="dry-run" checked={isDryRun} onCheckedChange={(checked) => setIsDryRun(!!checked)} />
                <Label htmlFor="dry-run" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                    Dry Run
                </Label>
            </div>
            <Button onClick={handleImport} disabled={!file || isUploading || selectedSheets.length === 0} className="w-full sm:w-auto">
              {isUploading ? <Spinner /> : isDryRun ? <><TestTube2 className="mr-2 h-4 w-4" /> Run Test</> : <><Upload className="mr-2 h-4 w-4" /> Import Shifts</>}
            </Button>
        </div>
      </div>
    </div>
  );
}
