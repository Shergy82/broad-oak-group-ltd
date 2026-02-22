'use client';

import React, { useState, useCallback } from 'react';
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
import { cn } from '@/lib/utils';

type ParsedShift = Omit<
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

interface FileUploaderProps {
  onImportComplete: (
    failedShifts: FailedShift[],
    onConfirm: () => Promise<void>,
    dryRunResult?: DryRunResult
  ) => void;
  onFileSelect: () => void;
  userProfile: UserProfile;
}

// ------------------------
// Helper functions
// ------------------------

const levenshtein = (a: string, b: string): number => {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) matrix[i][j] = matrix[i - 1][j - 1];
      else {
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

  // 1. Exact match on the full normalized name.
  const exactMatch = userMap.find(u => u.normalizedName === normalizedName);
  if (exactMatch) return exactMatch;

  // 2. Levenshtein distance-based matching
  let minDistance = 2; // Only allow very close matches (max 1 typo)
  let bestMatches: UserMapEntry[] = [];

  for (const user of userMap) {
    const distance = levenshtein(normalizedName, user.normalizedName);

    if (distance < minDistance) {
      minDistance = distance;
      bestMatches = [user]; // New best match found, clear previous
    } else if (distance === minDistance) {
      bestMatches.push(user); // Another match with the same best distance
    }
  }

  // Only return a match if it's unique to avoid ambiguity
  if (bestMatches.length === 1) {
    return bestMatches[0];
  }
  
  // 3. Fallback to first name + last initial (e.g. "philc" for "Phil Craig")
  if (bestMatches.length === 0) {
    const firstLastInitialMatch = userMap.find(u => {
        const parts = u.originalName.toLowerCase().split(' ');
        if (parts.length > 1) {
            const first = parts[0];
            const lastInitial = parts[parts.length - 1].charAt(0);
            if (normalizeText(`'${first + lastInitial}'`) === normalizedName) {
                return true;
            }
        }
        return false;
    });
    if (firstLastInitialMatch) return firstLastInitialMatch;
  }

  return null; // Return null if no clear, unambiguous match is found
};

const parseDate = (dateValue: any): Date | null => {
  if (!dateValue) return null;

  // Excel numeric date
  if (typeof dateValue === 'number' && dateValue > 1) {
    const excelEpoch = new Date(1899, 11, 30);
    const d = new Date(excelEpoch.getTime() + dateValue * 24 * 60 * 60 * 1000);
    if (!isNaN(d.getTime())) return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  }

  // String date
  if (typeof dateValue === 'string') {
    const s = dateValue.trim();
    const parsed = new Date(s);
    if (!isNaN(parsed.getTime())) {
      return new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()));
    }

    const lower = s.toLowerCase();
    const dateMatch = lower.match(/(\d{1,2})[ -/]+([a-z]{3})/);
    if (dateMatch) {
      const day = parseInt(dateMatch[1], 10);
      const monthStr = dateMatch[2];
      const monthIndex = new Date(Date.parse(monthStr + ' 1, 2012')).getMonth();
      if (!isNaN(day) && monthIndex !== -1) {
        const year = new Date().getFullYear();
        return new Date(Date.UTC(year, monthIndex, day));
      }
    }
  }

  if (dateValue instanceof Date && !isNaN(dateValue.getTime())) {
    return new Date(Date.UTC(dateValue.getFullYear(), dateValue.getMonth(), dateValue.getDate()));
  }

  return null;
};

const looksLikePostcode = (text: string) =>
  /\b[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}\b/i.test(text);

const isProbablyAddressText = (text: string) => {
  const t = (text || '').toString().trim();
  if (!t) return false;

  // E-number or B-number prefix
  if (/^(E|B)\d{4,}/i.test(t)) return true;

  // UK postcode
  if (looksLikePostcode(t)) return true;

  // Common street words
  if (/\b(road|rd|street|st|avenue|ave|close|cl|drive|dr|lane|ln|grove|court|ct|way)\b/i.test(t))
    return true;

  return false;
};

// New site always starts at JOB MANAGER row
const isSiteSeparatorRow = (row: any[]) => {
  const cells = (row || [])
    .map((c) => (c ?? '').toString().trim().toUpperCase())
    .filter(Boolean);

  if (cells.length === 0) return false;
  return cells.some((c) => c.includes('JOB MANAGER') || c.includes('SITE MANAGER') || c.includes('PROJECT MANAGER'));
};

const findAddressInBlock = (jsonData: any[][], startRow: number, endRow: number) => {
  for (let r = startRow; r < endRow; r++) {
    const row = jsonData[r] || [];

    // Scan left-side region where address block can appear (wider than before)
    for (let c = 0; c <= 12; c++) {
      const cell = row[c];
      if (typeof cell !== 'string') continue;

      const text = cell.trim();
      if (!isProbablyAddressText(text)) continue;

      // Merge downwards for multi-line addresses
      const lines: string[] = [text];
      for (let rr = r + 1; rr < endRow; rr++) {
        const next = (jsonData[rr]?.[c] ?? '').toString().trim();
        if (!next) break;

        const up = next.toUpperCase();
        if (
          up.includes('PROJECT MANAGER') ||
          up.includes('SITE MANAGER') ||
          up.includes('TENANT') ||
          up.includes('JOB MANAGER') ||
          up.includes('IGNORE')
        )
          break;

        // stop if clearly not address continuation
        if (!isProbablyAddressText(next) && next.length < 8) break;

        lines.push(next);
      }

      let address = lines.join(', ').replace(/\s+/g, ' ').trim();
      let eNumber = '';

      const m = address.match(/^((E|B)\d+)\s*/i);
      if (m) {
        eNumber = m[1].toUpperCase();
        address = address.replace(m[0], '').trim();
      }

      return { address, eNumber };
    }
  }

  return { address: '', eNumber: '' };
};

interface SiteContact {
  role: string;
  name: string;
  phone: string;
}

const findSiteContacts = (jsonData: any[][], startRow: number, endRow: number): SiteContact[] => {
    const contacts: SiteContact[] = [];
    const roles = ['SITE MANAGER', 'PROJECT MANAGER', 'JOB MANAGER', 'TLO'];
    
    for (let r = startRow; r < endRow; r++) {
        const row = jsonData[r] || [];
        for (let c = 0; c < row.length; c++) {
            const cellText = (row[c] || '').toString().trim();
            if (!cellText) continue;

            const upperCellText = cellText.toUpperCase();

            for (const role of roles) {
                if (upperCellText.startsWith(role)) {
                    let restOfText = cellText.substring(role.length).trim();
                    
                    let phoneMatch = restOfText.match(/(0\d[\d\s-]{8,})/);
                    let name = phoneMatch ? restOfText.substring(0, phoneMatch.index).trim() : restOfText;
                    let phone = phoneMatch ? phoneMatch[0].trim() : '';

                    if (!name) continue;

                    if (!phone && (r + 1 < endRow)) {
                        const textBelow = (jsonData[r+1]?.[c] || '').toString().trim();
                        if (/^(0\d[\d\s-]{8,})$/.test(textBelow)) {
                            phone = textBelow;
                        }
                    }

                    contacts.push({
                        role,
                        name: name.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' '),
                        phone
                    });
                    
                    break;
                }
            }
        }
    }
    return contacts;
};


const findDateHeaderRowInBlock = (jsonData: any[][], startRow: number, endRow: number) => {
  for (let r = startRow; r < endRow; r++) {
    const row = jsonData[r] || [];
    let dateCount = 0;

    for (let c = 0; c < row.length; c++) {
      if (parseDate(row[c])) dateCount++;
    }

    if (dateCount >= 1) {
      return { dateRowIndex: r, dateRow: row.map((cell) => parseDate(cell)) as (Date | null)[] };
    }
  }

  return { dateRowIndex: -1, dateRow: [] as (Date | null)[] };
};

const parseBuildSheet = (
    worksheet: XLSX.WorkSheet, 
    userMap: UserMapEntry[], 
    sheetName: string,
    department: string
): { shifts: ParsedShift[], failed: FailedShift[] } => {
    const jsonData = XLSX.utils.sheet_to_json<any[]>(worksheet, {
        header: 1,
        blankrows: false,
        defval: null,
      });

    if (jsonData.length < 2) {
    return { shifts: [], failed: [{
        date: null,
        projectAddress: 'Sheet',
        cellContent: '',
        reason: 'Build sheet has fewer than two rows (header + data).',
        sheetName,
        cellRef: 'A1'
    }] };
    }

    const headers = (jsonData[0] as any[]).map(h => String(h || '').trim().toLowerCase());
    const dateIndex = headers.indexOf('date');
    const addressIndex = headers.indexOf('address');
    const taskIndex = headers.indexOf('task');
    const operativeIndex = headers.indexOf('operative');
    const typeIndex = headers.indexOf('type');
    const eNumberIndex = headers.indexOf('enumber');
    const managerIndex = headers.indexOf('manager');
    const notesIndex = headers.indexOf('notes');

    if (dateIndex === -1 || addressIndex === -1 || taskIndex === -1 || operativeIndex === -1) {
        return { shifts: [], failed: [{
            date: null,
            projectAddress: 'Sheet Headers',
            cellContent: headers.join(', '),
            reason: 'Build sheet is missing required columns: "date", "address", "task", "operative".',
            sheetName,
            cellRef: 'A1'
        }] };
    }

    const shifts: ParsedShift[] = [];
    const failed: FailedShift[] = [];

    for (let i = 1; i < jsonData.length; i++) {
        const row = jsonData[i] as any[];
        const rowNum = i + 1;

        const date = parseDate(row[dateIndex]);
        const address = row[addressIndex];
        const task = row[taskIndex];
        const operativeName = row[operativeIndex];

        if (!date || !address || !task || !operativeName) {
            failed.push({
                date: date,
                projectAddress: address || 'N/A',
                cellContent: row.join(', '),
                reason: `Row ${'\'\''}${rowNum}${'\'\''} is missing required data (Date, Address, Task, or Operative).`,
                sheetName,
                cellRef: `A${'\'\''}${rowNum}${'\'\''}`
            });
            continue;
        }
        
        const user = findUser(operativeName, userMap);
        if (!user) {
            failed.push({
                date,
                projectAddress: address,
                cellContent: operativeName,
                reason: `Could not find a user matching "${'\'\''}${operativeName}${'\'\''}".`,
                sheetName,
                cellRef: XLSX.utils.encode_cell({r: i, c: operativeIndex})
            });
            continue;
        }

        let type: 'am' | 'pm' | 'all-day' = 'all-day';
        const rawType = (row[typeIndex] || '').toLowerCase();
        if (rawType === 'am') type = 'am';
        if (rawType === 'pm') type = 'pm';

        shifts.push({
            date,
            address,
            task,
            userId: user.uid,
            userName: user.originalName,
            type,
            eNumber: row[eNumberIndex] || '',
            manager: row[managerIndex] || '',
            notes: row[notesIndex] || '',
            contract: sheetName,
            department: department || '',
        });
    }

    return { shifts, failed };
}

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
    reader.onload = (e) => {
      const data = e.target?.result;
      if (!data) return;

      const workbook = XLSX.read(data, { type: 'array' });
      
      const visibleSheetNames = workbook.SheetNames.filter(name => workbook.Sheets[name].Hidden === undefined || workbook.Sheets[name].Hidden === 0);
      
      setSheetNames(visibleSheetNames);

      try {
        const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          const valid = parsed.filter((s: string) => visibleSheetNames.includes(s));
          setSelectedSheets(valid.length > 0 ? valid : visibleSheetNames.length > 0 ? [visibleSheetNames[0]] : []);
        } else {
          setSelectedSheets(visibleSheetNames.length > 0 ? [visibleSheetNames[0]] : []);
        }
      } catch {
        setSelectedSheets(visibleSheetNames.length > 0 ? [visibleSheetNames[0]] : []);
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
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(next));
    } catch (e) {
      console.warn('Could not save sheet selection to localStorage', e);
    }
  };

  const getShiftKey = (shift: { userId: string; date: Date | Timestamp; address: string }): string => {
    const d = (shift.date as any).toDate ? (shift.date as Timestamp).toDate() : (shift.date as Date);
    const normalizedDate = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    return `'${normalizedDate.toISOString().slice(0, 10)}-${'\'\''}' + shift.userId + '-' + normalizeText(shift.address) + ''`;
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

          const today = new Date();
          today.setUTCHours(0, 0, 0, 0);

          for (const sheetName of selectedSheets) {
            const worksheet = workbook.Sheets[sheetName];
            if (!worksheet) continue;
            
            if (userProfile.department === 'Build') {
              const { shifts, failed } = parseBuildSheet(
                worksheet,
                userMap,
                sheetName,
                userProfile.department || 'Build'
              );
              allShiftsFromExcel.push(...shifts);
              allFailedShifts.push(...failed);

            } else {
              // Existing logic for other departments
              const jsonData = XLSX.utils.sheet_to_json<any[]>(worksheet, {
                header: 1,
                blankrows: false,
                defval: null,
              });

              const blockStarts: number[] = [];
              for (let i = 0; i < jsonData.length; i++) {
                if (isSiteSeparatorRow(jsonData[i])) {
                  const start = Math.max(0, i);
                  blockStarts.push(start);
                }
              }
              if (blockStarts.length === 0) blockStarts.push(0);

              const starts = Array.from(new Set(blockStarts)).sort((a, b) => a - b);

              for (let i = 0; i < starts.length; i++) {
                const blockStartRowIndex = starts[i];
                const blockEndRowIndex = i + 1 < starts.length ? starts[i + 1] : jsonData.length;

                if (blockEndRowIndex - blockStartRowIndex < 5) continue;

                const { address, eNumber } = findAddressInBlock(jsonData, blockStartRowIndex, blockEndRowIndex);

                if (!address) {
                  allFailedShifts.push({
                    date: null,
                    projectAddress: `Block at row ${'\'\''}${blockStartRowIndex + 1}${'\'\''}`,
                    cellContent: '',
                    reason: 'Could not find a valid Address within this site block.',
                    sheetName,
                    cellRef: `A${'\'\''}${blockStartRowIndex + 1}${'\'\''}`,
                  });
                  continue;
                }

                const { dateRowIndex, dateRow } = findDateHeaderRowInBlock(
                  jsonData,
                  blockStartRowIndex,
                  blockEndRowIndex
                );

                if (dateRowIndex === -1) {
                  allFailedShifts.push({
                    date: null,
                    projectAddress: address,
                    cellContent: '',
                    reason: 'Could not find a valid Date Header Row within this site block.',
                    sheetName,
                    cellRef: `A${'\'\''}${blockStartRowIndex + 1}${'\'\''}`,
                  });
                  continue;
                }

                const contacts = findSiteContacts(jsonData, blockStartRowIndex, blockEndRowIndex);
                const managerContact = contacts.find(c => c.role.includes('MANAGER'));
                const manager = managerContact ? managerContact.name : '';
                const otherContacts = contacts.filter(c => c !== managerContact);
                const notes = otherContacts.map(c => `'${c.role}: ${c.name} ${c.phone}'`).join('\n');

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
                    if (!cellContent) continue;

                    let shiftType: 'am' | 'pm' | 'all-day' = 'all-day';
                    let remainingContent = cellContent;

                    if (/^\s*AM\b/i.test(remainingContent)) {
                      shiftType = 'am';
                      remainingContent = remainingContent.replace(/^\s*AM\b/i, '').trim();
                    } else if (/^\s*PM\b/i.test(remainingContent)) {
                      shiftType = 'pm';
                      remainingContent = remainingContent.replace(/^\s*PM\b/i, '').trim();
                    }

                    const lastDashIndex = remainingContent.lastIndexOf('-');
                    if (lastDashIndex === -1) continue;

                    const task = remainingContent.substring(0, lastDashIndex).trim();
                    const potentialUserNames = remainingContent.substring(lastDashIndex + 1).trim();

                    if (!task || !potentialUserNames) continue;


                    const usersInCell = potentialUserNames
                      .split(/[&,+/]/g)
                      .map((n) => n.trim())
                      .filter(Boolean);

                    if (usersInCell.length === 0) continue;

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
                          notes,
                          contract: sheetName,
                          department: userProfile.department || '',
                        });
                      } else {
                        allFailedShifts.push({
                          date: shiftDate,
                          projectAddress: address,
                          cellContent: cellContentRaw,
                          reason: `Could not find a user matching "${'\'\''}${userName}${'\'\''}".`,
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

          if (allShiftsFromExcel.length === 0 && allFailedShifts.length === 0) {
            toast({
              title: 'No Shifts Found',
              description:
                'The file was processed, but no shifts were found to import from the selected sheets.',
            });
            setIsUploading(false);
            return;
          }

          const allDatesFound = allShiftsFromExcel.map((s) => s.date).filter((d): d is Date => d !== null);

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

          const minDate = new Date(Math.min(...allDatesFound.map((d) => d.getTime())));
          const maxDate = new Date(Math.max(...allDatesFound.map((d) => d.getTime())));

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

          // Create / Update
          for (const [key, excelShift] of excelShiftsMap.entries()) {
            const existingShift = existingShiftsMap.get(key);

            if (!existingShift) {
              toCreate.push(excelShift);
            } else if (!protectedStatuses.includes(existingShift.status)) {
              // Only update if not completed/incomplete
              toUpdate.push({ old: existingShift, new: excelShift });
            }
          }


          // Deletions (only if key missing entirely)
          for (const [key, existingShift] of existingShiftsMap.entries()) {
            if (!excelShiftsMap.has(key) && !protectedStatuses.includes(existingShift.status)) {
              toDelete.push(existingShift);
            }
          }

          const onConfirm = async () => {
            const batch = writeBatch(firestore);
            const projectsRef = collection(firestore, 'projects');
            
            // --- Project Creation/Update Logic ---
            const allImportedShifts = [...toCreate, ...toUpdate.map(u => u.new)];
            const projectInfoFromImport = new Map<string, ParsedShift>();
            allImportedShifts.forEach(shift => {
                if (shift.address) {
                    projectInfoFromImport.set(shift.address, shift);
                }
            });

            if (projectInfoFromImport.size > 0) {
                const projectAddresses = Array.from(projectInfoFromImport.keys());
                // Firestore 'in' query is limited to 30 items
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

            // --- Shift Creation/Update/Deletion ---
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
            if (toCreate.length > 0) parts.push(`created ${'\'\''}${toCreate.length}${'\'\''} new shift(s)`);
            if (toUpdate.length > 0) parts.push(`updated ${'\'\''}${toUpdate.length}${'\'\''} shift(s)`);
            if (toDelete.length > 0) parts.push(`deleted ${'\'\''}${toDelete.length}${'\'\''} old shift(s)`);

            if (parts.length > 0) {
              toast({
                title: 'Import Complete & Reconciled',
                description: `Successfully processed the file: ${'\'\''}${parts.join(', ')}${'\'\''}.`,
              });
            } else if (allFailedShifts.length === 0) {
              toast({
                title: 'No Changes Detected',
                description: 'The schedule was up-to-date with the selected file.',
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
                          : `'${selectedSheets.length}' sheets selected`}
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
