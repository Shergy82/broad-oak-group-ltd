
'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { useToast } from '@/hooks/use-toast';
import { db, functions, httpsCallable } from '@/lib/firebase';
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
import { ScrollArea } from '../ui/scroll-area';
import { cn, getCorrectedLocalDate } from '@/lib/utils';
import { parseGasWorkbook, type ImportType, type ParsedGasShift } from '@/lib/exceljs-parser';


export type ParsedShift = Omit<
  Shift,
  'id' | 'status' | 'date' | 'createdAt' | 'userName' | 'contract'
> & {
  date: Date;
  userName: string;
  contract?: string;
  eNumber?: string;
};

type UserMapEntry = { uid: string; normalizedName: string; originalName: string, department?: string };

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

const normalizeText = (text: string) => (text || "").toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();

const parseDateSafe = (dateValue: any): Date | null => {
    if (!dateValue) return null;

    if (dateValue instanceof Date && !isNaN(dateValue.getTime())) {
        // Already a valid JS Date from XLSX parsing (as local timezone)
        // Normalize to UTC midnight based on local date parts to prevent timezone shift
        return new Date(Date.UTC(dateValue.getFullYear(), dateValue.getMonth(), dateValue.getDate()));
    }

    if (typeof dateValue === 'number' && dateValue > 1) {
        // Excel serial date (days from 1900). This is timezone-agnostic.
        // The formula (dateValue - 25569) * 86400 * 1000 converts it to UTC milliseconds since 1970 epoch.
        const d = new Date((dateValue - 25569) * 86400 * 1000);
        if (!isNaN(d.getTime())) {
            return d; // This is already UTC midnight
        }
    }

    if (typeof dateValue === 'string') {
        const s = dateValue.trim();
        if (!s) return null;

        // More robust date parsing for string formats
        const parts = s.match(/^(\d{1,2})[./-](\d{1,2})(?:[./-]?(\d{2,4}))?$/);
        if (parts) {
            const day = parseInt(parts[1], 10);
            const month = parseInt(parts[2], 10) - 1;
            let year = parts[3] ? parseInt(parts[3], 10) : new Date().getUTCFullYear();
            if (year < 100) year += 2000;
            if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
                const d = new Date(Date.UTC(year, month, day));
                // Validate parsed date, e.g., 32/01/2024 is invalid
                if (d.getUTCFullYear() === year && d.getUTCMonth() === month && d.getUTCDate() === day) {
                    return d;
                }
            }
        }
        
        // Final fallback: Let JS parse it (can be unreliable) and normalize to UTC
        const parsed = new Date(s);
        if (!isNaN(parsed.getTime())) {
             return new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()));
        }
    }

    return null;
};


const findUsersInMap = (nameChunk: string, userMap: UserMapEntry[]): { users: UserMapEntry[]; reason?: string } => {
    const normalizedChunk = normalizeText(nameChunk);
    if (!normalizedChunk) return { users: [], reason: 'Empty name provided.' };

    // 1. Exact match (most reliable)
    let matches = userMap.filter(u => u.normalizedName === normalizedChunk);
    if (matches.length === 1) return { users: matches };
    if (matches.length > 1) return { users: [], reason: `Ambiguous name "${nameChunk}" matches multiple users exactly.` };

    // 2. The query is a substring of the full name (e.g., "Shergold" finds "Phil Shergold")
    matches = userMap.filter(u => u.normalizedName.includes(normalizedChunk));
    if (matches.length === 1) return { users: matches };
    if (matches.length > 1) return { users: [], reason: `Ambiguous name "${nameChunk}" matches multiple users.` };
    
    // 3. Fallback for Matrix-style parsing: Last name match
    const chunkParts = normalizedChunk.split(' ');
    const lastName = chunkParts[chunkParts.length - 1];
    if (lastName) {
        matches = userMap.filter(u => u.normalizedName.endsWith(' ' + lastName));
        if (matches.length === 1) return { users: matches };
        if (matches.length > 1) {
            // Disambiguate by first initial if possible
             if (chunkParts.length > 1) {
                const firstInitial = chunkParts[0].charAt(0);
                const initialMatches = matches.filter(u => u.normalizedName.startsWith(firstInitial));
                if (initialMatches.length === 1) return { users: initialMatches };
            }
            return { users: [], reason: `Ambiguous name "${nameChunk}" matches multiple users by last name.` };
        }
    }
    
    return { users: [], reason: `No user found for name: "${nameChunk}".` };
};


const extractUsersAndTask = (
  text: string,
  userMap: UserMapEntry[]
): { users: UserMapEntry[]; task: string; type: 'am' | 'pm' | 'all-day', reason?: string } | null => {
  if (!text || typeof text !== 'string') return null;

  let raw = text.trim();
  if (!raw) return null;

  let shiftType: 'am' | 'pm' | 'all-day' = 'all-day';

  if (/^AM\b/i.test(raw)) {
    shiftType = 'am';
    raw = raw.substring(2).trim();
  } else if (/^PM\b/i.test(raw)) {
    shiftType = 'pm';
    raw = raw.substring(2).trim();
  }

  const lastHyphenIndex = raw.lastIndexOf('-');
  if (lastHyphenIndex === -1) {
    return {
      users: [],
      task: raw,
      type: shiftType,
      reason: 'No " - " separator found to distinguish task from names.',
    };
  }

  const taskPart = raw.substring(0, lastHyphenIndex).trim();
  const namesPart = raw.substring(lastHyphenIndex + 1).trim();

  if (!namesPart) {
    return {
      users: [],
      task: taskPart,
      type: shiftType,
      reason: 'No names found after the " - " separator.',
    };
  }

  const nameChunks = namesPart.split(/,|\/|&|\b\s*and\s*\b/i).map(s => s.trim()).filter(Boolean);

  if (nameChunks.length === 0) {
      return {
          users: [],
          task: taskPart,
          type: shiftType,
          reason: `No valid names found in cell part: "${namesPart}"`
      };
  }

  const allMatchedUsers: UserMapEntry[] = [];
  let failureReason: string | null = null;
  
  for (const chunk of nameChunks) {
      const result = findUsersInMap(chunk, userMap);
      if (result.users.length === 1) {
          if (!allMatchedUsers.some(u => u.uid === result.users[0].uid)) {
              allMatchedUsers.push(result.users[0]);
          }
      } else {
          failureReason = result.reason || `Failed to match user for "${chunk}".`;
          break;
      }
  }

  if (failureReason) {
    return {
      users: [],
      task: taskPart,
      type: shiftType,
      reason: failureReason,
    };
  }
  
  if (allMatchedUsers.length === 0) {
      return {
          users: [],
          task: taskPart,
          type: shiftType,
          reason: `Could not identify any valid users from "${namesPart}".`
      }
  }
  
  return {
    users: allMatchedUsers,
    task: taskPart,
    type: shiftType,
  };
};

const parseBuildSheet = (
  worksheet: XLSX.WorkSheet,
  userMap: UserMapEntry[],
  sheetName: string,
  department: string
): { shifts: ParsedShift[]; failed: FailedShift[] } => {
  const getLocalShiftKey = (shift: { userId: string; date: Date | Timestamp; address: string; task: string; }): string => {
    const d = (shift.date as any).toDate ? (shift.date as Timestamp).toDate() : (shift.date as Date);
    const normalizedDate = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    return `${normalizedDate.toISOString().slice(0, 10)}-${shift.userId}-${normalizeText(shift.address)}-${normalizeText(shift.task)}`;
  };
  
  const data: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });
  if (data.length < 2) return { shifts: [], failed: [] };

  const allShifts: ParsedShift[] = [];
  const allFailed: FailedShift[] = [];

  const headers = data[0].map(h => String(h || '').trim().toLowerCase());
  const dateIndex = headers.indexOf('date');
  const userIndex = headers.indexOf('user');
  const taskIndex = headers.indexOf('task');
  const addressIndex = headers.indexOf('address');

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  // --- NEW: LIST VIEW PARSER ---
  if (dateIndex !== -1 && (userIndex !== -1 || headers.includes('operative')) && taskIndex !== -1 && addressIndex !== -1) {
    const operativeIndex = userIndex !== -1 ? userIndex : headers.indexOf('operative');
    
    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        if (!row || row.every((cell: any) => !cell)) continue;

        const cellRef = `A${i + 1}`;
        
        const date = parseDateSafe(row[dateIndex]);
        const userNameRaw = String(row[operativeIndex] || '').trim();
        const task = String(row[taskIndex] || '').trim();
        const address = String(row[addressIndex] || '').trim();

        if (!date || !userNameRaw || !task || !address) {
            if (userNameRaw || task || address) {
                 allFailed.push({ date, projectAddress: address, cellContent: `Row ${i+1}`, reason: 'Missing required data (Date, User, Task, or Address).', sheetName, cellRef });
            }
            continue;
        }
        
        if (date < today) continue; // Skip past shifts
        
        const { users: matchedUsers, reason } = findUsersInMap(userNameRaw, userMap);

        if (matchedUsers.length !== 1) {
             allFailed.push({ date, projectAddress: address, cellContent: userNameRaw, reason: reason || `Ambiguous or no user match for "${userNameRaw}"`, sheetName, cellRef });
             continue;
        }
        
        const user = matchedUsers[0];

        allShifts.push({
            date,
            address: address,
            eNumber: '',
            task: task,
            userId: user.uid,
            userName: user.originalName,
            type: 'all-day',
            manager: sheetName,
            contract: '',
            department,
            notes: '',
        });
    }
  } else {
    // --- ORIGINAL: MATRIX VIEW PARSER ---
    const dateRowRaw = data[0];
    const dateRow: (Date | null)[] = dateRowRaw.map(parseDateSafe);
    
    let currentAddress = '';
    let currentENumber = '';
    let currentContract = '';

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row || row.every((cell: any) => !cell)) continue;

      const newAddressAndENumber = String(row[0] || '').trim();
      if (newAddressAndENumber) {
        const eNumMatch = newAddressAndENumber.match(/\b([BE]\d+\S*)$/i);
        if (eNumMatch) {
          currentENumber = eNumMatch[0].toUpperCase();
          currentAddress = newAddressAndENumber.replace(eNumMatch[0], '').trim().replace(/,$/, '').trim();
        } else {
          currentAddress = newAddressAndENumber;
          currentENumber = '';
        }
        currentContract = String(row[2] || '').trim() || currentContract;
      }

      if (!currentAddress) continue;

      for (let c = 5; c < row.length; c++) {
        const cellText = String(row[c] || '').trim();
        const cellRef = XLSX.utils.encode_cell({ c: c, r: i });

        if (cellText && /[a-zA-Z]/.test(cellText)) {
          const date = dateRow[c];

          if (!date) {
            allFailed.push({ date: null, projectAddress: currentAddress, cellContent: cellText, reason: 'No date found for this column.', sheetName, cellRef });
            continue;
          }

          if (date < today) continue;

          const extraction = extractUsersAndTask(cellText, userMap);
          
          if (!extraction || extraction.users.length === 0) {
              allFailed.push({ date, projectAddress: currentAddress, cellContent: cellText, reason: extraction?.reason || 'No users found.', sheetName, cellRef });
              continue;
          }

          for (const user of extraction.users) {
            allShifts.push({
              date,
              address: currentAddress,
              eNumber: currentENumber,
              task: extraction.task,
              userId: user.uid,
              userName: user.originalName,
              type: extraction.type,
              manager: sheetName,
              contract: currentContract,
              department,
              notes: '',
            });
          }
        }
      }
    }
  }

  const uniqueShiftsMap = new Map<string, ParsedShift>();
  for (const shift of allShifts) {
    const key = getLocalShiftKey(shift);
    if (!uniqueShiftsMap.has(key)) {
      uniqueShiftsMap.set(key, shift);
    }
  }
  const uniqueShifts = Array.from(uniqueShiftsMap.values());

  return { shifts: uniqueShifts, failed: allFailed };
};


interface FileUploaderProps {
  onImportComplete: (failedShifts: FailedShift[], onConfirm: () => Promise<void>, dryRunResult?: DryRunResult) => void;
  onFileSelect: () => void;
  userProfile: UserProfile;
  importDepartment: string;
  importType: ImportType;
}

const LOCAL_STORAGE_KEY = 'shiftImport_selectedSheets_v2';

export function FileUploader({ onImportComplete, onFileSelect, userProfile, importDepartment, importType }: FileUploaderProps) {
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
          if (name.startsWith('_')) return false;
          const sheet = workbook.Sheets[name];
          // @ts-ignore
          if (sheet?.Hidden === 1 || sheet?.Hidden === '1' || sheet?.Hidden === true) return false;
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

  const getShiftKey = (shift: { userId: string; date: Date | Timestamp; address: string; task: string; }): string => {
    const d = (shift.date as any).toDate ? (shift.date as Timestamp).toDate() : (shift.date as Date);
    const normalizedDate = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    return `${normalizedDate.toISOString().slice(0, 10)}-${shift.userId}-${normalizeText(shift.address)}-${normalizeText(shift.task)}`;
  };

  const runImport = useCallback(
    async (commitChanges: boolean) => {
      const firestore = db;
      if (!file || !firestore) {
        setError('Please select a file first.');
        return;
      }

      if (importType === 'BUILD' && selectedSheets.length === 0) {
        setError('No sheets selected. Please enable at least one sheet to import.');
        return;
      }

      setIsUploading(true);
      setError(null);

      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const data = e.target?.result;
          if (!(data instanceof ArrayBuffer)) throw new Error('Could not read file data as ArrayBuffer.');
          
          let allShiftsFromExcel: ParsedShift[] = [];
          let allFailedShifts: FailedShift[] = [];

          const usersSnapshot = await getDocs(collection(firestore, 'users'));
          const userMap: UserMapEntry[] = usersSnapshot.docs.map((d) => {
            const u = d.data() as UserProfile;
            return { uid: d.id, normalizedName: normalizeText(u.name), originalName: u.name, department: u.department };
          });
          

          if (importType === 'GAS') {
              if (typeof parseGasWorkbook !== 'function') {
                  throw new Error("GAS import logic is not available. The parsing function could not be loaded.");
              }
              const { parsed, failures } = await parseGasWorkbook(Buffer.from(data), userMap);
              
              for (const parsedShift of parsed) {
                  allShiftsFromExcel.push({
                      date: new Date(parsedShift.shiftDate),
                      address: parsedShift.siteAddress,
                      task: parsedShift.task,
                      userId: parsedShift.user.uid,
                      userName: parsedShift.user.originalName,
                      type: parsedShift.type,
                      manager: parsedShift.manager || '',
                      contract: parsedShift.contract || parsedShift.source.sheetName || '',
                      department: 'Gas',
                      notes: parsedShift.notes || '',
                      eNumber: parsedShift.eNumber || '',
                  });
              }
              
              allFailedShifts.push(...failures.map(f => ({
                  date: f.shiftDate ? new Date(f.shiftDate) : null,
                  projectAddress: f.siteAddress || 'Unknown',
                  cellContent: f.operativeNameRaw || '',
                  reason: f.reason,
                  sheetName: f.sheetName || 'Unknown Sheet',
                  cellRef: f.cellRef || 'N/A'
              })));

          } else { // BUILD
              const workbook = XLSX.read(data, {
                type: 'array',
                cellDates: true,
                cellStyles: true,
              });
    
              for (const sheetName of selectedSheets) {
                const worksheet = workbook.Sheets[sheetName];
                if (!worksheet) continue;
                
                const { shifts: buildShifts, failed: buildFailed } = parseBuildSheet(
                  worksheet,
                  userMap,
                  sheetName,
                  importDepartment
                );
                allShiftsFromExcel.push(...buildShifts);
                allFailedShifts.push(...buildFailed);
              }
          }

          const today = new Date();
          today.setUTCHours(0, 0, 0, 0);

          const futureShiftsFromExcel = allShiftsFromExcel.filter(s => s.date >= today);
          const pastShiftCount = allShiftsFromExcel.length - futureShiftsFromExcel.length;

          allShiftsFromExcel = futureShiftsFromExcel;

          if (allShiftsFromExcel.length === 0 && allFailedShifts.length === 0) {
            let toastDescription = 'The file was processed, but no shifts were found to import from the selected sheets. Check for structural issues.';
             if (pastShiftCount > 0) {
              toastDescription = `The file was processed, but only past shifts were found (${pastShiftCount} skipped). No changes will be made.`
            }
            toast({
              variant: 'default',
              title: 'No New Shifts to Import',
              description: toastDescription,
            });
            setIsUploading(false);
            return;
          }
          
          const finalImportDepartment = importType === 'GAS' ? 'Gas' : importDepartment;
          
          const existingShiftsQuery = query(
            collection(firestore, 'shifts'),
            where('department', '==', finalImportDepartment)
          );
          
          const existingShiftsSnapshot = await getDocs(existingShiftsQuery);
          
          const existingShiftsMap = new Map<string, Shift>();
          existingShiftsSnapshot.forEach((doc) => {
            const shiftData = { id: doc.id, ...doc.data() } as Shift;
            if (!shiftData.userId || !shiftData.date || !shiftData.address || !shiftData.task) return;
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

          const importToday = new Date();
          importToday.setUTCHours(0, 0, 0, 0);

          for (const [key, existingShift] of existingShiftsMap.entries()) {
            if (!excelShiftsMap.has(key) && !protectedStatuses.includes(existingShift.status) && existingShift.source !== 'manual') {
              const shiftDate = getCorrectedLocalDate(existingShift.date as any);
              if (shiftDate >= importToday) {
                toDelete.push(existingShift);
              }
            }
          }

          const onConfirm = async () => {
            try {
              if (!functions) throw new Error("Functions service is not initialized.");
              
              const reconcileShiftsFn = httpsCallable(functions, 'reconcileShifts');
              
              // Serialize data for the callable function
              const payload = {
                toCreate: toCreate.map(s => ({ ...s, date: s.date.toISOString() })),
                toUpdate: toUpdate.map(u => ({
                  id: u.old.id,
                  new: { ...u.new, date: u.new.date.toISOString() }
                })),
                toDelete: toDelete.map(s => ({ id: s.id })),
                department: finalImportDepartment
              };

              const result = await reconcileShiftsFn(payload);
              
              toast({
                title: 'Import Complete & Reconciled',
                description: (result.data as any).message || `Successfully processed: ${toCreate.length} created, ${toUpdate.length} updated, ${toDelete.length} deleted.`,
              });

            } catch (error: any) {
              console.error("Error during shift reconciliation:", error);
              if (error.code === 'functions/permission-denied' || (error.details && error.details.code === 'PERMISSION_DENIED')) {
                toast({
                  variant: 'destructive',
                  title: 'Permission Denied',
                  description: 'You do not have permission to import shifts for this department.',
                  duration: 10000,
                });
              } else {
                toast({
                  variant: 'destructive',
                  title: 'Reconciliation Failed',
                  description: error.message || 'An unknown error occurred on the server.',
                  duration: 10000,
                });
              }
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
    [file, selectedSheets, toast, onImportComplete, onFileSelect, userProfile, importDepartment, importType]
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

            {importType === 'BUILD' && sheetNames.length > 0 && (
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
                disabled={!file || isUploading || (importType === 'BUILD' && selectedSheets.length === 0)}
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
