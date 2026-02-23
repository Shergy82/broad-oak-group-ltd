'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import {
  collection,
  writeBatch,
  doc,
  getDocs,
  query,
  where,
  Timestamp,
  serverTimestamp,
  limit,
} from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/shared/spinner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Upload,
  FileWarning,
  TestTube2,
  Sheet,
  ChevronDown,
  X,
  UploadCloud,
  FileIcon,
} from 'lucide-react';
import type { Shift, UserProfile, Project, ShiftStatus } from '@/types';
import { Checkbox } from '../ui/checkbox';
import { Label } from '../ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '../ui/scroll-area';
import { cn, getCorrectedLocalDate } from '@/lib/utils';

export type ParsedShift = Omit<
  Shift,
  'id' | 'status' | 'date' | 'createdAt' | 'userName' | 'contract'
> & {
  date: Date;
  userName: string;
  contract?: string;
  eNumber?: string;
};

type UserMapEntry = { uid: string; normalizedName: string; originalName: string };

export interface FailedShift {
  date: Date | null;
  projectAddress: string;
  cellContent: string;
  reason: string;
  sheetName: string;
  cellRef: string;
}

export interface DryRunResult {
  toCreate: ParsedShift[];
  toUpdate: { old: Shift; new: ParsedShift }[];
  toDelete: Shift[];
  failed: FailedShift[];
}

// =================================================================================================
// NEW, ROBUST PARSING LOGIC
// =================================================================================================

const normalizeText = (text: string) => (text || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const parseDate = (dateValue: any): Date | null => {
  if (!dateValue) return null;
  if (dateValue instanceof Date && !isNaN(dateValue.getTime())) {
    return dateValue;
  }
  if (typeof dateValue === 'number' && dateValue > 1) {
    const excelEpoch = new Date(1899, 11, 30);
    const d = new Date(excelEpoch.getTime() + dateValue * 24 * 60 * 60 * 1000);
    if (!isNaN(d.getTime())) {
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    }
  }
  if (typeof dateValue === 'string') {
    const s = dateValue.trim();
    if (!s) return null;
    const parts = s.match(/^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?$/);
    if (parts) {
      const day = parseInt(parts[1], 10);
      const month = parseInt(parts[2], 10) - 1;
      let year = parts[3] ? parseInt(parts[3], 10) : new Date().getFullYear();
      if (year < 100) year += 2000;
      if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
        const d = new Date(Date.UTC(year, month, day));
        if (d.getUTCFullYear() === year && d.getUTCMonth() === month && d.getUTCDate() === day) {
          return d;
        }
      }
    }
    const parsed = new Date(s);
    if (!isNaN(parsed.getTime())) {
      return new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()));
    }
  }
  return null;
};

const isRowEmpty = (row: any[]): boolean => {
  if (!row || row.length === 0) return true;
  return row.every(cell => cell === null || cell === undefined || String(cell).trim() === '');
};

const extractUserAndTask = (text: string, userMap: UserMapEntry[]): { user: UserMapEntry, task: string } | null => {
  if (!text || typeof text !== 'string') return null;
  const trimmedText = text.trim();
  if (!trimmedText) return null;
  const sortedUsers = [...userMap].sort((a, b) => b.originalName.length - a.originalName.length);
  for (const user of sortedUsers) {
    if (trimmedText.toLowerCase().endsWith(user.originalName.toLowerCase())) {
      const task = trimmedText.substring(0, trimmedText.length - user.originalName.length).trim();
      if (task) {
        return { user, task };
      }
    }
  }
  return null;
};

/**
 * Processes a single block of rows from the spreadsheet. A block is defined as a set of rows
 * between two empty "black line" rows.
 */
const processProjectBlock = (
  block: any[][],
  dateRow: (Date | null)[],
  userMap: UserMapEntry[],
  manager: string,
  department: string,
  today: Date
): { shifts: ParsedShift[], failed: FailedShift[] } => {
    const shifts: ParsedShift[] = [];
    const failed: FailedShift[] = [];

    // 1. Find the split between the header (project info) and the body (shift data)
    let firstShiftRowIndex = -1;
    for (let i = 0; i < block.length; i++) {
        const row = block[i];
        // Scan cells starting from column B (index 1) to find the first user name
        for (let c = 1; c < row.length; c++) {
            if (extractUserAndTask(String(row[c] || ''), userMap)) {
                firstShiftRowIndex = i;
                break;
            }
        }
        if (firstShiftRowIndex !== -1) break;
    }

    if (firstShiftRowIndex === -1) {
        // This block has no recognizable shifts, so we skip it.
        return { shifts, failed };
    }

    const headerRows = block.slice(0, firstShiftRowIndex);
    const shiftRows = block.slice(firstShiftRowIndex);

    // 2. Extract project information from the header rows
    let address = '', eNumber = '', contract = '';
    for (const hRow of headerRows) {
        // Address and E-Number are always in the first column (A)
        const cellA = String(hRow[0] || '').trim();
        if (cellA) {
            const eNumMatch = cellA.match(/\b([BE]\d+\S*)$/i);
            if (eNumMatch) {
                eNumber = eNumMatch[0].toUpperCase();
                address = cellA.replace(eNumMatch[0], '').trim().replace(/,$/, '').trim();
            } else {
                address = cellA;
            }
        }
        // The contract is in any *other* column in the header
        for (let c = 1; c < hRow.length; c++) {
            const potentialContract = String(hRow[c] || '').trim();
            if (potentialContract) {
                contract = potentialContract;
            }
        }
    }

    if (!address) {
        // If we couldn't find an address for this block, we can't create shifts for it.
        return { shifts, failed };
    }

    // 3. Process the shift rows to create shift objects
    for (const sRow of shiftRows) {
        // Ignore rows that only have content in the first column (likely header remnants)
        const hasShiftContent = sRow.slice(1).some(cell => String(cell || '').trim());
        if (!hasShiftContent) continue;

        for (let c = 1; c < Math.min(sRow.length, dateRow.length); c++) {
            const date = dateRow[c];
            const cellText = String(sRow[c] || '').trim();

            if (date && cellText && date >= today) {
                const extraction = extractUserAndTask(cellText, userMap);
                if (extraction) {
                    shifts.push({
                        date,
                        address,
                        eNumber,
                        task: extraction.task,
                        userId: extraction.user.uid,
                        userName: extraction.user.originalName,
                        type: 'all-day',
                        manager,
                        contract: contract || 'Uncategorized',
                        department,
                        notes: '',
                    });
                }
            }
        }
    }

    return { shifts, failed };
};

const parseBuildSheet = (
    worksheet: XLSX.WorkSheet, 
    userMap: UserMapEntry[], 
    sheetName: string,
    department: string
): { shifts: ParsedShift[], failed: FailedShift[] } => {
    const jsonData = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1, blankrows: true, defval: null });
    const allShifts: ParsedShift[] = [];
    const allFailed: FailedShift[] = [];
    
    // Rule 1: Date row is ALWAYS Row 1
    const dateRow = (jsonData[0] || []).map(cell => parseDate(cell));
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    if (dateRow.length === 0 || dateRow.slice(1).every(d => d === null)) {
        allFailed.push({ date: null, projectAddress: 'Entire Sheet', cellContent: '', reason: 'Could not find a valid date row in Row 1.', sheetName, cellRef: 'Row 1' });
        return { shifts: allShifts, failed: allFailed };
    }
    
    // Find all blocks separated by empty rows
    let currentBlock: any[][] = [];
    for (let r = 1; r < jsonData.length; r++) {
        const row = jsonData[r] || [];
        if (isRowEmpty(row)) {
            if (currentBlock.length > 0) {
                const { shifts, failed } = processProjectBlock(currentBlock, dateRow, userMap, sheetName, department, today);
                allShifts.push(...shifts);
                allFailed.push(...failed);
            }
            currentBlock = [];
        } else {
            currentBlock.push(row);
        }
    }
    // Process the last block if the file doesn't end with an empty row
    if (currentBlock.length > 0) {
        const { shifts, failed } = processProjectBlock(currentBlock, dateRow, userMap, sheetName, department, today);
        allShifts.push(...shifts);
        allFailed.push(...failed);
    }
    
    return { shifts: allShifts, failed: allFailed };
};

// =================================================================================================
// END OF NEW PARSING LOGIC
// =================================================================================================


const LOCAL_STORAGE_KEY = 'shiftImport_selectedSheets_v2';

export function FileUploader({ onImportComplete, onFileSelect, userProfile, importDepartment }: FileUploaderProps) {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDryRun, setIsDryRun] = useState(true);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheets, setSelectedSheets] = useState<string[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const { toast } = useToast();

  const handleClear = () => {
    setFile(null);
    setSheetNames([]);
    setSelectedSheets([]);
    setError(null);
    const fileInput = document.getElementById('shift-file-input') as HTMLInputElement;
    if (fileInput) fileInput.value = '';
    onFileSelect();
  };

  const processFile = (selectedFile: File) => {
    setFile(selectedFile);
    setError(null);
    onFileSelect();

    const reader = new FileReader();
    reader.onload = (e) => {
      const data = e.target?.result;
      if (!data) return;

      const workbook = XLSX.read(data, { type: 'array' });
      
      const visibleSheetNames = workbook.SheetNames.filter(name => {
          if (name.startsWith('_')) {
              return false;
          }
          // @ts-ignore
          const sheet = workbook.Sheets[name];
          if (sheet?.Hidden === 1 || sheet?.Hidden === '1' || sheet?.Hidden === true) {
              return false;
          }
          return true;
      });
      
      setSheetNames(visibleSheetNames);

      try {
        const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          const valid = parsed.filter((s: string) => visibleSheetNames.includes(s));
          setSelectedSheets(valid);
        } else {
          setSelectedSheets(visibleSheetNames);
        }
      } catch {
        setSelectedSheets(visibleSheetNames);
      }
    };

    reader.readAsArrayBuffer(selectedFile);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) processFile(selectedFile);
  };

  const toggleSheet = (sheetName: string) => {
    const next = selectedSheets.includes(sheetName)
      ? selectedSheets.filter((s) => s !== sheetName)
      : [...selectedSheets, sheetName];

    setSelectedSheets(next);

    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(Array.from(next)));
    } catch (e) {
      console.warn('Could not save sheet selection to localStorage', e);
    }
  };

  const getShiftKey = (shift: { userId: string; date: Date | Timestamp; address: string }): string => {
    const d = (shift.date as any).toDate ? (shift.date as Timestamp).toDate() : (shift.date as Date);
    const normalizedDate = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    return `${normalizedDate.toISOString().slice(0, 10)}-${shift.userId}-${normalizeText(shift.address)}`;
  };

  const runImport = useCallback(
    async (commitChanges: boolean) => {
      const firestore = db;
      if (!file || !firestore) {
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
          if (!data) throw new Error('Could not read file data.');

          const workbook = XLSX.read(data, {
            type: 'array',
            cellDates: true,
            cellStyles: true,
          });

          const usersSnapshot = await getDocs(collection(firestore, 'users'));
          const userMap: UserMapEntry[] = usersSnapshot.docs.map((d) => {
            const u = d.data() as UserProfile;
            return { uid: d.id, normalizedName: normalizeText(u.name), originalName: u.name };
          });

          const allShiftsFromExcel: ParsedShift[] = [];
          const allFailedShifts: FailedShift[] = [];

          for (const sheetName of selectedSheets) {
            const worksheet = workbook.Sheets[sheetName];
            if (!worksheet) continue;
            
            const { shifts, failed } = parseBuildSheet(
              worksheet,
              userMap,
              sheetName,
              importDepartment
            );
            allShiftsFromExcel.push(...shifts);
            allFailedShifts.push(...failed);
          }

          if (allShiftsFromExcel.length === 0 && allFailedShifts.length === 0) {
            toast({
              variant: 'destructive',
              title: 'No Shifts Found',
              description:
                'The file was processed, but no shifts were found to import from the selected sheets. Check for structural issues.',
            });
            setIsUploading(false);
            return;
          }

          const allDatesFound = allShiftsFromExcel.map((s) => s.date).filter((d): d is Date => d !== null);

          if (allDatesFound.length === 0) {
            if (allFailedShifts.length > 0) {
              onImportComplete(allFailedShifts, async () => {}, {
                toCreate: [],
                toUpdate: [],
                toDelete: [],
                failed: allFailedShifts,
              });
            } else {
               toast({
                variant: 'destructive',
                title: 'No Shifts Found',
                description: 'No valid shifts with dates were found in the selected sheets.',
              });
            }
            setIsUploading(false);
            return;
          }

          const minDate = new Date(Math.min(...allDatesFound.map((d) => d.getTime())));
          const maxDate = new Date(Math.max(...allDatesFound.map((d) => d.getTime())));
          const today = new Date();
          today.setUTCHours(0, 0, 0, 0);

          const shiftsQuery = query(
            collection(firestore, 'shifts'),
            where('date', '>=', Timestamp.fromDate(minDate)),
            where('date', '<=', Timestamp.fromDate(maxDate))
          );

          const existingShiftsSnapshot = await getDocs(shiftsQuery);

          const existingShiftsMap = new Map<string, Shift>();
          existingShiftsSnapshot.forEach((d) => {
            const shiftData = { id: d.id, ...d.data() } as Shift;
            if (!shiftData.userId || !shiftData.date || !shiftData.address) return;
            existingShiftsMap.set(getShiftKey(shiftData as any), shiftData);
          });

          const excelShiftsMap = new Map<string, ParsedShift>();
          for (const excelShift of allShiftsFromExcel) {
            excelShiftsMap.set(getShiftKey(excelShift as any), excelShift);
          }

          const toCreate: ParsedShift[] = [];
          const toUpdate: { old: Shift; new: ParsedShift }[] = [];
          const toDelete: Shift[] = [];
          const protectedStatuses: ShiftStatus[] = ['completed', 'incomplete'];

          for (const [key, excelShift] of excelShiftsMap.entries()) {
            const existingShift = existingShiftsMap.get(key);

            if (!existingShift) {
              toCreate.push(excelShift);
            } else if (!protectedStatuses.includes(existingShift.status)) {
              const hasChanged =
                (existingShift.task || '') !== (excelShift.task || '') ||
                (existingShift.type || 'all-day') !== (excelShift.type || 'all-day') ||
                (existingShift.eNumber || '') !== (excelShift.eNumber || '') ||
                (existingShift.manager || '') !== (excelShift.manager || '') ||
                (existingShift.notes || '') !== (excelShift.notes || '') ||
                (existingShift.contract || '') !== (excelShift.contract || '') ||
                (existingShift.department || '') !== (excelShift.department || '');

              if (hasChanged) {
                toUpdate.push({ old: existingShift, new: excelShift });
              }
            }
          }

          for (const [key, existingShift] of existingShiftsMap.entries()) {
            if (!excelShiftsMap.has(key) && !protectedStatuses.includes(existingShift.status)) {
              const shiftDate = getCorrectedLocalDate(existingShift.date as any);
              if (shiftDate >= today) {
                toDelete.push(existingShift);
              }
            }
          }

          const onConfirm = async () => {
            const batch = writeBatch(firestore);
            const projectsRef = collection(firestore, 'projects');
            
            const allImportedShifts = [...toCreate, ...toUpdate.map(u => u.new)];
            const projectInfoFromImport = new Map<string, ParsedShift>();
            allImportedShifts.forEach(shift => {
                if (shift.address) {
                    projectInfoFromImport.set(shift.address, shift);
                }
            });

            if (projectInfoFromImport.size > 0) {
                const projectAddresses = Array.from(projectInfoFromImport.keys());
                for (let i = 0; i < projectAddresses.length; i += 30) {
                    const chunk = projectAddresses.slice(i, i + 30);
                    const existingProjectsQuery = query(projectsRef, where('address', 'in', chunk));
                    const existingProjectsSnap = await getDocs(existingProjectsQuery);
                    
                    const foundAddresses = new Set<string>();
                    existingProjectsSnap.forEach(docSnap => {
                        const project = docSnap.data() as Project;
                        foundAddresses.add(project.address);
                        const importInfo = projectInfoFromImport.get(project.address);
                        if (importInfo && project.contract !== importInfo.contract) {
                            batch.update(docSnap.ref, { contract: importInfo.contract });
                        }
                    });

                    chunk.forEach(address => {
                        if (!foundAddresses.has(address)) {
                             const info = projectInfoFromImport.get(address);
                             if (info) {
                                const reviewDate = new Date();
                                reviewDate.setDate(reviewDate.getDate() + 28);
                                batch.set(doc(projectsRef), {
                                    address: info.address,
                                    eNumber: info.eNumber || '',
                                    manager: info.manager || '',
                                    contract: info.contract || '',
                                    department: info.department || '',
                                    createdAt: serverTimestamp(),
                                    createdBy: userProfile.name,
                                    creatorId: userProfile.uid,
                                    nextReviewDate: Timestamp.fromDate(reviewDate),
                                });
                             }
                        }
                    });
                }
            }

            toCreate.forEach((shift) => {
              const newShiftData = {
                ...shift,
                date: Timestamp.fromDate(shift.date),
                status: 'pending-confirmation' as ShiftStatus,
                createdAt: serverTimestamp(),
              };
              batch.set(doc(collection(firestore, 'shifts')), newShiftData);
            });

            toUpdate.forEach(({ old, new: newShift }) => {
              batch.update(doc(firestore, 'shifts', old.id), {
                address: newShift.address,
                task: newShift.task,
                type: newShift.type,
                eNumber: newShift.eNumber || '',
                manager: newShift.manager || '',
                notes: newShift.notes || '',
                contract: newShift.contract || '',
                status: 'pending-confirmation',
              });
            });

            toDelete.forEach((shift) => {
              batch.delete(doc(firestore, 'shifts', shift.id));
            });

            await batch.commit();
            
            const parts: string[] = [];
            if (toCreate.length > 0) parts.push(`created ${toCreate.length} new shift(s)`);
            if (toUpdate.length > 0) parts.push(`updated ${toUpdate.length} shift(s)`);
            if (toDelete.length > 0) parts.push(`deleted ${toDelete.length} old shift(s)`);

            if (parts.length > 0) {
              toast({
                title: 'Import Complete & Reconciled',
                description: `Successfully processed the file: ${parts.join(', ')}.`,
              });
            } else if (allFailedShifts.length === 0) {
              toast({
                title: 'No Changes Detected',
                description: 'The schedule is already up-to-date with the selected file.',
              });
            }
          };

          if (!commitChanges) {
            onImportComplete(allFailedShifts, onConfirm, {
              toCreate,
              toUpdate,
              toDelete,
              failed: allFailedShifts,
            });
            setIsUploading(false);
            return;
          }

          await onConfirm();
          onImportComplete(allFailedShifts, onConfirm);
          handleClear();
        } catch (err: any) {
          console.error('Import failed:', err);
          setError(err?.message || 'An unexpected error occurred during import.');
          onImportComplete([], async () => {}, undefined);
        } finally {
          setIsUploading(false);
        }
      };

      reader.onerror = () => {
        setError('Failed to read the file.');
        setIsUploading(false);
      };

      reader.readAsArrayBuffer(file);
    },
    [file, selectedSheets, toast, onImportComplete, onFileSelect, userProfile, importDepartment]
  );

  const handleImport = () => {
    runImport(isDryRun === false);
  };

  const onDragProps = {
    onDragOver: (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragOver(true);
    },
    onDragLeave: (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragOver(false);
    },
    onDrop: (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragOver(false);
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        processFile(e.dataTransfer.files[0]);
        e.dataTransfer.clearData();
      }
    },
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
        {!file ? (
          <div
            {...onDragProps}
            className={cn(
              'flex flex-col items-center justify-center p-6 border-2 border-dashed border-muted-foreground/30 rounded-lg text-center transition-colors h-48',
              isDragOver && 'border-primary bg-primary/10'
            )}
          >
            <UploadCloud className="h-12 w-12 text-muted-foreground" />
            <h3 className="mt-2 text-sm font-medium text-foreground">Drag & drop Excel file here</h3>
            <p className="mt-1 text-xs text-muted-foreground">or click to select a file</p>

            <Input
              id="shift-file-input"
              type="file"
              accept=".xlsx, .xls, .xlsm"
              className="sr-only"
              onChange={handleFileChange}
            />

            <Button asChild variant="link" className="mt-2">
              <Label htmlFor="shift-file-input" className="cursor-pointer">
                Browse file
              </Label>
            </Button>
          </div>
        ) : (
          <div className="p-4 border rounded-lg space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <FileIcon className="h-6 w-6 text-primary" />
                <div>
                  <p className="text-sm font-medium">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{Math.round(file.size / 1024)} KB</p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleClear}
                className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>

            {sheetNames.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="sheet-select">Select Sheets to Import</Label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button id="sheet-select" variant="outline" className="w-full justify-between">
                      <span className="truncate">
                        {selectedSheets.length === 0
                          ? 'Select sheets...'
                          : selectedSheets.length === 1
                          ? selectedSheets[0]
                          : `${selectedSheets.length} sheets selected`}
                      </span>
                      <ChevronDown className="h-4 w-4 opacity-50" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">
                    <DropdownMenuLabel>Available Sheets</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <ScrollArea className="h-72">
                      {sheetNames.map((name) => (
                        <DropdownMenuCheckboxItem
                          key={name}
                          checked={selectedSheets.includes(name)}
                          onCheckedChange={() => toggleSheet(name)}
                          onSelect={(e) => e.preventDefault()}
                        >
                          <Sheet className="mr-2 h-4 w-4 text-muted-foreground" />
                          {name}
                        </DropdownMenuCheckboxItem>
                      ))}
                    </ScrollArea>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>
        )}

        {file && (
          <div className="flex flex-col sm:flex-row gap-4 pt-2">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="dry-run"
                checked={isDryRun}
                onCheckedChange={(checked) => setIsDryRun(!!checked)}
              />
              <Label
                htmlFor="dry-run"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Dry Run
              </Label>
            </div>

            <div className="flex items-center gap-2">
              <Button
                onClick={handleImport}
                disabled={!file || isUploading || selectedSheets.length === 0}
                className="w-full sm:w-auto"
              >
                {isUploading ? (
                  <Spinner />
                ) : isDryRun ? (
                  <>
                    <TestTube2 className="mr-2 h-4 w-4" /> Run Test
                  </>
                ) : (
                  <>
                    <Upload className="mr-2 h-4 w-4" /> Import Shifts
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}