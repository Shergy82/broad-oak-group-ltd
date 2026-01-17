'use client';

import { useState, useCallback } from 'react';
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
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

type ParsedShift = Omit<
  Shift,
  'id' | 'status' | 'date' | 'createdAt' | 'userName' | 'contract' | 'eNumber'
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

interface FileUploaderProps {
  onImportComplete: (
    failedShifts: FailedShift[],
    onConfirm: () => Promise<void>,
    dryRunResult?: DryRunResult
  ) => void;
  onFileSelect: () => void;
  userProfile: UserProfile;
}

// --- Helper Functions ---
const levenshtein = (a: string, b: string): number => {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix: number[][] = [];
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

const normalizeText = (text: string) =>
  (text || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const findUser = (name: string, userMap: UserMapEntry[]): UserMapEntry | null => {
  const normalizedName = normalizeText(name);
  if (!normalizedName) return null;

  let bestMatch: UserMapEntry | null = null;
  let minDistance = Infinity;

  for (const user of userMap) {
    if (user.normalizedName === normalizedName) return user;

    const distance = levenshtein(normalizedName, user.normalizedName);

    if (user.normalizedName.includes(normalizedName)) {
      if (distance < minDistance) {
        minDistance = distance;
        bestMatch = user;
      }
    }

    const firstNameNormalized = normalizeText(user.originalName.split(' ')[0]);
    if (firstNameNormalized === normalizedName) {
      const firstNameDistance = levenshtein(normalizedName, firstNameNormalized);
      if (firstNameDistance < minDistance) {
        minDistance = firstNameDistance;
        bestMatch = user;
      }
    }

    const threshold = Math.max(1, Math.floor(normalizedName.length / 3));
    if (distance <= threshold && distance < minDistance) {
      minDistance = distance;
      bestMatch = user;
    }
  }

  if (bestMatch && minDistance <= 3) return bestMatch;
  return null;
};

const parseDate = (dateValue: any): Date | null => {
  if (!dateValue) return null;

  if (typeof dateValue === 'number' && dateValue > 1) {
    const excelEpoch = new Date(1899, 11, 30);
    const d = new Date(excelEpoch.getTime() + dateValue * 24 * 60 * 60 * 1000);
    if (!isNaN(d.getTime())) {
      return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    }
  }

  if (typeof dateValue === 'string') {
    const lowerCell = dateValue.toLowerCase();

    const dateMatch = lowerCell.match(/(\d{1,2})[ -/]+([a-z]{3})/);
    if (dateMatch) {
      const day = parseInt(dateMatch[1], 10);
      const monthStr = dateMatch[2];
      const monthIndex = new Date(Date.parse(monthStr + ' 1, 2012')).getMonth();
      if (!isNaN(day) && monthIndex !== -1) {
        const year = new Date().getFullYear();
        return new Date(Date.UTC(year, monthIndex, day));
      }
    }

    const dayNameMatch = lowerCell.match(
      /(mon|tue|wed|thu|fri|sat|sun)\s+(\d{1,2})[ -/]+([a-z]{3})/
    );
    if (dayNameMatch) {
      const day = parseInt(dayNameMatch[2], 10);
      const monthStr = dayNameMatch[3];
      const monthIndex = new Date(Date.parse(monthStr + ' 1, 2012')).getMonth();
      if (!isNaN(day) && monthIndex !== -1) {
        const year = new Date().getFullYear();
        return new Date(Date.UTC(year, monthIndex, day));
      }
    }
  }

  if (dateValue instanceof Date && !isNaN(dateValue.getTime())) {
    return new Date(
      Date.UTC(dateValue.getFullYear(), dateValue.getMonth(), dateValue.getDate())
    );
  }

  return null;
};

const LOCAL_STORAGE_KEY = 'shiftImport_selectedSheets';

export function FileUploader({ onImportComplete, onFileSelect, userProfile }: FileUploaderProps) {
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
    reader.onload = e => {
      const data = e.target?.result;
      if (!data) return;

      const workbook = XLSX.read(data, { type: 'array', bookSheets: true });
      const allSheets = workbook.SheetNames;
      setSheetNames(allSheets);

      try {
        const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          const valid = parsed.filter((s: string) => allSheets.includes(s));
          setSelectedSheets(valid.length > 0 ? valid : allSheets.length > 0 ? [allSheets[0]] : []);
        } else {
          setSelectedSheets(allSheets.length > 0 ? [allSheets[0]] : []);
        }
      } catch {
        setSelectedSheets(allSheets.length > 0 ? [allSheets[0]] : []);
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
      ? selectedSheets.filter(s => s !== sheetName)
      : [...selectedSheets, sheetName];

    setSelectedSheets(next);

    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(next));
    } catch (e) {
      console.warn('Could not save sheet selection to localStorage', e);
    }
  };

  const getShiftKey = (shift: {
    userId: string;
    date: Date | Timestamp;
    task: string;
    address: string;
    type: 'am' | 'pm' | 'all-day';
  }): string => {
    const d = (shift.date as any).toDate ? (shift.date as Timestamp).toDate() : (shift.date as Date);
    const normalizedDate = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    return `${normalizedDate.toISOString().slice(0, 10)}-${shift.userId}-${shift.type}-${normalizeText(
      shift.address
    )}-${normalizeText(shift.task)}`;
  };

  const runImport = useCallback(
    async (commitChanges: boolean) => {
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
      reader.onload = async e => {
        try {
          const data = e.target?.result;
          if (!data) throw new Error('Could not read file data.');

          const workbook = XLSX.read(data, {
            type: 'array',
            cellDates: true,
            cellStyles: true,
          });

          const usersSnapshot = await getDocs(collection(db, 'users'));
          const userMap: UserMapEntry[] = usersSnapshot.docs.map(d => {
            const u = d.data() as UserProfile;
            return { uid: d.id, normalizedName: normalizeText(u.name), originalName: u.name };
          });

          const allShiftsFromExcel: ParsedShift[] = [];
          const allFailedShifts: FailedShift[] = [];

          const today = new Date();
          today.setUTCHours(0, 0, 0, 0);

          for (const sheetName of selectedSheets) {
            const worksheet = workbook.Sheets[sheetName];
            if (!worksheet) continue;

            const jsonData = XLSX.utils.sheet_to_json<any[]>(worksheet, {
              header: 1,
              blankrows: false,
              defval: null,
            });

            const projectBlockStartRows: number[] = [];
            jsonData.forEach((row, i) => {
              const cellA = (row[0] || '').toString().trim().toUpperCase();
              if (cellA.includes('JOB MANAGER')) projectBlockStartRows.push(i);
            });

            if (projectBlockStartRows.length === 0) continue;

            for (let i = 0; i < projectBlockStartRows.length; i++) {
              const blockStartRowIndex = projectBlockStartRows[i];
              const blockEndRowIndex =
                i + 1 < projectBlockStartRows.length ? projectBlockStartRows[i + 1] : jsonData.length;

              let manager = '';
              let address = '';
              let eNumber = '';
              let dateRow: (Date | null)[] = [];
              let dateRowIndex = -1;

              let managerRowIndex = -1;
              let addressRowIndex = -1;

              for (let r = blockStartRowIndex; r < blockEndRowIndex; r++) {
                const row = jsonData[r] || [];
                const cellAValue = (row[0] || '').toString().trim().toUpperCase();

                if (cellAValue.includes('JOB MANAGER')) managerRowIndex = r + 1;
                if (cellAValue.includes('ADDRESS')) addressRowIndex = r + 1;

                if (dateRowIndex === -1) {
                  const dayAbbrs = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
                  const monthAbbrs = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
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

              if (managerRowIndex !== -1 && managerRowIndex < blockEndRowIndex) {
                manager = jsonData[managerRowIndex]?.[0] || 'Unknown Manager';
              }

              if (addressRowIndex !== -1) {
                const fullAddress: string[] = [];
                for (let r = addressRowIndex; r < blockEndRowIndex; r++) {
                  const addrPart = jsonData[r]?.[0];
                  if (addrPart && typeof addrPart === 'string' && addrPart.trim() !== '') {
                    fullAddress.push(addrPart.trim());
                  } else {
                    break;
                  }
                }

                if (fullAddress.length > 0) {
                  const firstLine = fullAddress[0];
                  const eNumberMatch = firstLine.match(/^(E\d+)\s*/i);
                  if (eNumberMatch) {
                    eNumber = eNumberMatch[0].trim();
                    fullAddress[0] = firstLine.replace(eNumberMatch[0], '').trim();
                  }
                  address = fullAddress.join(', ');
                }
              }

              if (!address) {
                allFailedShifts.push({
                  date: null,
                  projectAddress: `Block at row ${blockStartRowIndex + 1}`,
                  cellContent: '',
                  reason: 'Could not find a valid Address within this project block.',
                  sheetName,
                  cellRef: `A${blockStartRowIndex + 1}`,
                });
                continue;
              }

              if (dateRowIndex === -1) {
                allFailedShifts.push({
                  date: null,
                  projectAddress: address,
                  cellContent: '',
                  reason: 'Could not find a valid Date Row within this project block.',
                  sheetName,
                  cellRef: `A${blockStartRowIndex + 1}`,
                });
                continue;
              }

              for (let r = dateRowIndex + 1; r < blockEndRowIndex; r++) {
                const rowData = jsonData[r];
                if (!rowData) continue;

                for (let c = 1; c < dateRow.length; c++) {
                  const shiftDate = dateRow[c];
                  const cellRef = XLSX.utils.encode_cell({ r, c });

                  if (!shiftDate) continue;
                  if (shiftDate < today) continue;

                  const cell = worksheet[cellRef];
                  const cellContentRaw = cell?.w || cell?.v;
                  if (!cellContentRaw || typeof cellContentRaw !== 'string') continue;

                  const cellContent = cellContentRaw.replace(/\s+/g, ' ').trim();
                  const bgColor = cell?.s?.fgColor?.rgb;
                  if (bgColor === 'FF800080' || bgColor === '800080') continue;

                  let shiftType: 'am' | 'pm' | 'all-day' = 'all-day';
                  let remainingContent = cellContent;

                  const amRegex = /^\s*AM\b/i;
                  const pmRegex = /^\s*PM\b/i;

                  if (amRegex.test(remainingContent)) {
                    shiftType = 'am';
                    remainingContent = remainingContent.replace(amRegex, '').trim();
                  } else if (pmRegex.test(remainingContent)) {
                    shiftType = 'pm';
                    remainingContent = remainingContent.replace(pmRegex, '').trim();
                  }

                  const parts = remainingContent.split('-').map(p => p.trim());
                  if (parts.length > 1) {
                    const potentialUserNames = parts.pop()!;
                    const task = parts.join('-').trim();

                    const usersInCell = potentialUserNames
                      .split(/&|,|\+/g)
                      .map(n => n.trim())
                      .filter(Boolean);

                    if (task && usersInCell.length > 0) {
                      for (const userName of usersInCell) {
                        const user = findUser(userName, userMap);
                        if (user) {
                          allShiftsFromExcel.push({
                            task,
                            userId: user.uid,
                            userName: user.originalName,
                            type: shiftType,
                            date: shiftDate,
                            address,
                            eNumber,
                            manager,
                            contract: sheetName, // ✅ sheet name stored as contract
                          });
                        } else {
                          allFailedShifts.push({
                            date: shiftDate,
                            projectAddress: address,
                            cellContent: cellContentRaw,
                            reason: `Could not find a user matching "${userName}".`,
                            sheetName,
                            cellRef,
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
              description:
                'The file was processed, but no shifts were found to import from the selected sheets.',
            });
            setIsUploading(false);
            return;
          }

          const allDatesFound = allShiftsFromExcel.map(s => s.date).filter((d): d is Date => d !== null);
          if (allDatesFound.length === 0 && allFailedShifts.length > 0) {
            onImportComplete(allFailedShifts, async () => {}, {
              toCreate: [],
              toUpdate: [],
              toDelete: [],
              failed: allFailedShifts,
            });
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
          existingShiftsSnapshot.forEach(d => {
            const shiftData = { id: d.id, ...d.data() } as Shift;
            existingShiftsMap.set(getShiftKey(shiftData), shiftData);
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
            if (existingShift) {
              if (
                (existingShift as any).eNumber !== (excelShift.eNumber || '') ||
                (existingShift as any).manager !== (excelShift.manager || '') ||
                (existingShift as any).contract !== (excelShift.contract || '')
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
            const projectsRef = collection(db, 'projects');
            const existingProjectsSnapshot = await getDocs(projectsRef);
            const existingProjectAddresses = new Set(
              existingProjectsSnapshot.docs.map(d => (d.data() as Project).address)
            );

            toCreate.forEach(shift => {
              const newShiftData = {
                ...shift,
                date: Timestamp.fromDate(shift.date),
                status: 'pending-confirmation',
                createdAt: serverTimestamp(),
              };
              batch.set(doc(collection(db, 'shifts')), newShiftData);

              if (shift.address && !existingProjectAddresses.has(shift.address)) {
                const reviewDate = new Date();
                reviewDate.setDate(reviewDate.getDate() + 28);

                const newProject = {
                  address: shift.address,
                  eNumber: shift.eNumber || '',
                  manager: shift.manager || '',
                  createdAt: serverTimestamp(),
                  createdBy: userProfile.name,
                  creatorId: userProfile.uid,
                  nextReviewDate: Timestamp.fromDate(reviewDate),
                };

                batch.set(doc(projectsRef), newProject);
                existingProjectAddresses.add(shift.address);
              }
            });

            toUpdate.forEach(({ old, new: newShift }) => {
              batch.update(doc(db, 'shifts', old.id), {
                eNumber: newShift.eNumber || '',
                manager: newShift.manager || '',
                contract: newShift.contract || '',
              });
            });

            toDelete.forEach(shift => {
              batch.delete(doc(db, 'shifts', shift.id));
            });

            if (toCreate.length > 0 || toUpdate.length > 0 || toDelete.length > 0) {
              await batch.commit();
            }

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
                description: 'The schedule was up-to-date. No changes were made.',
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
          setError(err.message || 'An unexpected error occurred during import.');
          onImportComplete([], async () => {});
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
    [file, selectedSheets, toast, onImportComplete, onFileSelect, userProfile]
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
              accept=".xlsx, .xls"
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
                      {sheetNames.map(name => (
                        <DropdownMenuCheckboxItem
                          key={name}
                          checked={selectedSheets.includes(name)}
                          onCheckedChange={() => toggleSheet(name)}
                          onSelect={e => e.preventDefault()}
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
              <Checkbox id="dry-run" checked={isDryRun} onCheckedChange={checked => setIsDryRun(!!checked)} />
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
