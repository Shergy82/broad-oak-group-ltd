

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
import { parseGasWorkbook, type ImportType, type RawParsedShift } from '@/lib/exceljs-parser';


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

const normalizeText = (text: string) => (text || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();

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
  
  const findUser = (chunk: string): UserMapEntry | { error: string } => {
      const normalizedChunk = normalizeText(chunk);
      if (!normalizedChunk) return { error: `Empty name chunk found.` };

      const exactMatches = userMap.filter(u => u.normalizedName === normalizedChunk);
      if (exactMatches.length === 1) return exactMatches[0];
      if (exactMatches.length > 1) return { error: `Ambiguous name "${chunk}" matches multiple users exactly.` };

      const partialMatches = userMap.filter(u => u.normalizedName.split(' ').includes(normalizedChunk));
      if (partialMatches.length === 1) return partialMatches[0];
      if (partialMatches.length > 1) {
         return { error: `Ambiguous name "${chunk}" matches: ${partialMatches.slice(0,3).map(m => m.originalName).join(', ')}.` };
      }
      
      if (!normalizedChunk.includes(' ')) {
          const singleNameMatches = userMap.filter(u => u.normalizedName.startsWith(normalizedChunk + ' ') || u.normalizedName.endsWith(' ' + normalizedChunk));
           if (singleNameMatches.length === 1) return singleNameMatches[0];
           if (singleNameMatches.length > 1) {
                return { error: `Ambiguous name "${chunk}" matches start/end of: ${singleNameMatches.slice(0,3).map(m => m.originalName).join(', ')}.` };
           }
      }

      return { error: `No user found for name: "${chunk}".` };
  };

  for (const chunk of nameChunks) {
      const result = findUser(chunk);
      if ('error' in result) {
          failureReason = result.error;
          break;
      }
      if (!allMatchedUsers.some(u => u.uid === result.uid)) {
          allMatchedUsers.push(result);
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
): { shifts: ParsedShift[], failed: FailedShift[] } => {
  const data: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });
  if (data.length < 2) return { shifts: [], failed: [] };

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const dateRowRaw = data[0];
  const dateRow: (Date | null)[] = dateRowRaw.map(parseDate);
  const manager = sheetName;

  const allShifts: ParsedShift[] = [];
  const allFailed: FailedShift[] = [];

  let currentAddress = '';
  let currentENumber = '';
  let currentContract = '';

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (isRowEmpty(row)) continue;

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
            manager,
            contract: currentContract,
            department,
            notes: '',
          });
        }
      }
    }
  }

  return { shifts: allShifts, failed: allFailed };
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
            return { uid: d.id, normalizedName: normalizeText(u.name), originalName: u.name };
          });
          
          const findUser = (chunk: string): UserMapEntry | { error: string } => {
              const normalizedChunk = normalizeText(chunk);
              if (!normalizedChunk) return { error: 'Empty name chunk' };
          
              // 1. Exact match
              const exactMatches = userMap.filter(u => u.normalizedName === normalizedChunk);
              if (exactMatches.length === 1) return exactMatches[0];
              if (exactMatches.length > 1) return { error: `Ambiguous name (exact): "${chunk}"` };
          
              // 2. Prefix-based match (for "Phil" vs "Philip")
              const chunkParts = normalizedChunk.split(' ');
              
              if (chunkParts.length >= 2) {
                  const chunkLastName = chunkParts[chunkParts.length - 1];
                  const chunkFirstName = chunkParts[0];
          
                  const prefixMatches = userMap.filter(user => {
                      const userParts = user.normalizedName.split(' ');
                      if (userParts.length < 2) return false;
                      
                      const userLastName = userParts[userParts.length - 1];
                      const userFirstName = userParts[0];
                      
                      return userLastName === chunkLastName && (userFirstName.startsWith(chunkFirstName) || chunkFirstName.startsWith(userFirstName));
                  });
          
                  if (prefixMatches.length === 1) return prefixMatches[0];
                  if (prefixMatches.length > 1) return { error: `Ambiguous name (prefix): "${chunk}"` };
              }
              
              return { error: `Could not match operative: ${chunk}` };
          };

          if (importType === 'GAS') {
              if (typeof parseGasWorkbook !== 'function') {
                  throw new Error("GAS import logic is not available. The parsing function could not be loaded.");
              }
              const { parsed, failures } = await parseGasWorkbook(Buffer.from(data));
              
              for (const rawShift of parsed) {
                  const userResult = findUser(rawShift.operativeNameRaw);
                   if ('error' in userResult) {
                       failures.push({
                           reason: userResult.error,
                           siteAddress: rawShift.siteAddress,
                           operativeNameRaw: rawShift.operativeNameRaw,
                           sheetName: rawShift.source.sheetName,
                           cellRef: rawShift.source.cellRef,
                       });
                   } else {
                        const user = userResult;
                        allShiftsFromExcel.push({
                            date: new Date(rawShift.shiftDate),
                            address: rawShift.siteAddress,
                            task: rawShift.task,
                            userId: user.uid,
                            userName: user.originalName,
                            type: rawShift.type,
                            manager: '',
                            contract: '',
                            department: importDepartment,
                            notes: '',
                        });
                   }
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
          
          const existingShiftsQuery = query(
            collection(firestore, 'shifts'),
            where('department', '==', importDepartment)
          );
          
          const existingShiftsSnapshot = await getDocs(existingShiftsQuery);
          
          const existingShiftsMap = new Map<string, Shift>();
          existingShiftsSnapshot.forEach((doc) => {
            const shiftData = { id: doc.id, ...doc.data() } as Shift;
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

          const today = new Date();
          today.setUTCHours(0, 0, 0, 0);

          for (const [key, existingShift] of existingShiftsMap.entries()) {
            if (!excelShiftsMap.has(key) && !protectedStatuses.includes(existingShift.status) && existingShift.source !== 'manual') {
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
                source: 'import',
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
