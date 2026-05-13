'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
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

const toDateOnlyUtc = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/**
 * Creates a unique key for a shift based on User, Date, and Address.
 */
const getShiftKey = (shift: { userId: string; date: Date | Timestamp; address: string }): string => {
  const d = (shift.date as any).toDate ? (shift.date as Timestamp).toDate() : (shift.date as Date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const dateStr = `${year}-${month}-${day}`;
  
  return `${dateStr}-${shift.userId}-${normalizeText(shift.address)}`;
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
          if (!(data instanceof ArrayBuffer)) throw new Error('Could not read file data.');
          
          let allShiftsFromExcel: ParsedShift[] = [];
          let allFailedShifts: FailedShift[] = [];

          const usersSnapshot = await getDocs(collection(firestore, 'users'));
          const userMap: UserMapEntry[] = usersSnapshot.docs.map((d) => {
            const u = d.data() as UserProfile;
            return { uid: d.id, normalizedName: normalizeText(u.name), originalName: u.name, department: u.department };
          });
          
          if (importType === 'GAS') {
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
          } else {
              const workbook = XLSX.read(data, { type: 'array', cellDates: true });
              // Simplified Build Logic
              selectedSheets.forEach(sheetName => {
                  const sheet = workbook.Sheets[sheetName];
                  const rows = XLSX.utils.sheet_to_json(sheet) as any[];
                  rows.forEach(row => {
                      // Implementation details for Build would be here
                  });
              });
          }

          const uniqueShiftsMap = new Map<string, ParsedShift>();
          for (const shift of allShiftsFromExcel) {
            const key = getShiftKey(shift as any);
            if (!uniqueShiftsMap.has(key)) {
              uniqueShiftsMap.set(key, shift);
            }
          }
          allShiftsFromExcel = Array.from(uniqueShiftsMap.values());

          const today = new Date();
          today.setHours(0, 0, 0, 0);

          allShiftsFromExcel = allShiftsFromExcel.filter(s => s.date >= today);
          
          const finalImportDepartment = importType === 'GAS' ? 'Gas' : importDepartment;
          
          const existingShiftsQuery = importType === 'GAS' 
            ? query(collection(firestore, 'shifts'))
            : query(collection(firestore, 'shifts'), where('department', '==', finalImportDepartment));
          
          const existingShiftsSnapshot = await getDocs(existingShiftsQuery);
          
          const existingShiftsMap = new Map<string, Shift>();
          existingShiftsSnapshot.forEach((doc) => {
            const shiftData = { id: doc.id, ...doc.data() } as Shift;
            if (!shiftData.userId || !shiftData.date || !shiftData.address) return;
            if (importType === 'GAS' && shiftData.department && shiftData.department !== 'Gas') return;
            existingShiftsMap.set(getShiftKey(shiftData as any), shiftData);
          });

          const excelShiftsMap = new Map<string, ParsedShift>();
          for (const excelShift of allShiftsFromExcel) {
            excelShiftsMap.set(getShiftKey(excelShift as any), excelShift);
          }

          const toCreate: ParsedShift[] = [];
          const toUpdate: { old: Shift; new: ParsedShift }[] = [];
          const toDelete: Shift[] = [];
          
          // GAS ONLY: Extend protection to confirmed/on-site shifts to prevent "disappearing" issue
          const protectedStatuses: ShiftStatus[] = finalImportDepartment === 'Gas'
            ? ['completed', 'incomplete', 'rejected', 'confirmed', 'on-site']
            : ['completed', 'incomplete'];

          for (const [key, excelShift] of excelShiftsMap.entries()) {
            const existingShift = existingShiftsMap.get(key);
            if (!existingShift) {
              toCreate.push(excelShift);
            } else if (!protectedStatuses.includes(existingShift.status)) {
              const hasChanged =
                normalizeText(existingShift.task) !== normalizeText(excelShift.task) ||
                normalizeText(existingShift.eNumber || '') !== normalizeText(excelShift.eNumber || '') ||
                normalizeText(existingShift.manager || '') !== normalizeText(excelShift.manager || '') ||
                normalizeText(existingShift.notes || '') !== normalizeText(excelShift.notes || '') ||
                normalizeText(existingShift.contract || '') !== normalizeText(excelShift.contract || '') ||
                existingShift.type !== excelShift.type; 

              if (hasChanged) {
                toUpdate.push({ old: existingShift, new: excelShift });
              }
            }
          }

          const importTodayLocal = new Date();
          importTodayLocal.setHours(0, 0, 0, 0);

          for (const [key, existingShift] of existingShiftsMap.entries()) {
            if (!excelShiftsMap.has(key) && !protectedStatuses.includes(existingShift.status) && existingShift.source !== 'manual') {
              const shiftDate = getCorrectedLocalDate(existingShift.date as any);
              if (shiftDate >= importTodayLocal) {
                toDelete.push(existingShift);
              }
            }
          }

          const onConfirm = async () => {
            try {
              if (!functions) throw new Error("Functions service not initialized.");
              const reconcileShiftsFn = httpsCallable(functions, 'reconcileShifts');
              const payload = {
                toCreate: toCreate.map(s => ({ ...s, date: toDateOnlyUtc(s.date).toISOString() })),
                toUpdate: toUpdate.map(u => ({
                  id: u.old.id,
                  new: { ...u.new, date: toDateOnlyUtc(u.new.date).toISOString() }
                })),
                toDelete: toDelete.map(s => ({ id: s.id })),
                department: finalImportDepartment
              };
              const result = await reconcileShiftsFn(payload);
              toast({
                title: 'Import Complete',
                description: (result.data as any).message || 'Changes published successfully.',
              });
            } catch (error: any) {
              console.error("Error during reconciliation:", error);
              toast({ variant: 'destructive', title: 'Error', description: error.message || 'Action failed.' });
            }
          };

          if (!commitChanges) {
            onImportComplete(allFailedShifts, onConfirm, { toCreate, toUpdate, toDelete, failed: allFailedShifts });
            setIsUploading(false);
            return;
          }

          await onConfirm();
          onImportComplete(allFailedShifts, onConfirm);
          handleClear();
        } catch (err: any) {
          console.error('Import failed:', err);
          setError(err?.message || 'An unexpected error occurred.');
          onImportComplete([], async () => {}, undefined);
        } finally {
          setIsUploading(false);
        }
      };
      reader.readAsArrayBuffer(file);
    },
    [file, selectedSheets, toast, onImportComplete, onFileSelect, userProfile, importDepartment, importType]
  );

  const handleImport = () => {
    runImport(isDryRun === false);
  };

  const onDragProps = {
    onDragOver: (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); setIsDragOver(true); },
    onDragLeave: (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); setIsDragOver(false); },
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
            <Input id="shift-file-input" type="file" accept=".xlsx, .xls, .xlsm" className="sr-only" onChange={handleFileChange} />
            <Button asChild variant="link" className="mt-2">
              <Label htmlFor="shift-file-input" className="cursor-pointer">Browse file</Label>
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
              <Button variant="ghost" size="icon" onClick={handleClear} className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"><X className="h-5 w-5" /></Button>
            </div>

            {importType === 'BUILD' && sheetNames.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="sheet-select">Select Sheets to Import</Label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button id="sheet-select" variant="outline" className="w-full justify-between">
                      <span className="truncate">
                        {selectedSheets.length === 0 ? 'Select sheets...' : selectedSheets.length === 1 ? selectedSheets[0] : `${selectedSheets.length} sheets selected`}
                      </span>
                      <ChevronDown className="h-4 w-4 opacity-50" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">
                    <DropdownMenuLabel>Available Sheets</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <ScrollArea className="h-72">
                      {sheetNames.map((name) => (
                        <DropdownMenuCheckboxItem key={name} checked={selectedSheets.includes(name)} onCheckedChange={() => toggleSheet(name)} onSelect={(e) => e.preventDefault()}>
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
              <Checkbox id="dry-run" checked={isDryRun} onCheckedChange={(checked) => setIsDryRun(!!checked)} />
              <Label htmlFor="dry-run" className="text-sm font-medium leading-none">Dry Run</Label>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={handleImport} disabled={!file || isUploading || (importType === 'BUILD' && selectedSheets.length === 0)} className="w-full sm:w-auto">
                {isUploading ? <Spinner /> : isDryRun ? <><TestTube2 className="mr-2 h-4 w-4" /> Run Test</> : <><Upload className="mr-2 h-4 w-4" /> Import Shifts</>}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
