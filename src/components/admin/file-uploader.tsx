'use client';

import { useState, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { db, functions, httpsCallable } from '@/lib/firebase';
import {
  collection,
  getDocs,
  query,
  where,
  Timestamp,
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
  HelpCircle,
} from 'lucide-react';
import type { Shift, UserProfile, ShiftStatus } from '@/types';
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
import { parseGasWorkbook, parseBuildWorkbook, type ImportType, type ParsedGasShift, type DiagnosticIssue } from '@/lib/exceljs-parser';
import { isValid, startOfToday } from 'date-fns';


export type ParsedShift = Omit<
  Shift,
  'id' | 'status' | 'date' | 'createdAt' | 'userName' | 'contract'
> & {
  date: Date;
  userName: string;
  contract?: string;
  eNumber?: string;
};

type UserMapEntry = { 
  uid: string; 
  normalizedName: string; 
  originalName: string; 
  department?: string;
  accountType?: 'individual' | 'company';
};

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
  diagnostics?: DiagnosticIssue[];
}

function normalizePlannerName(name: string | null | undefined): string {
  if (!name) return "";
  return name.replace(/\.[^/.]+$/, "").replace(/\s*\(\d+\)$/, "").toLowerCase().trim();
}

function normalizeText(text: string | null | undefined): string {
  if (!text) return "";
  let t = String(text).toLowerCase();
  t = t.replace(/\b(0\d{3,4}\s*\d{5,6}|07\d{3}\s*\d{6}|\+44\s*\d{4}\s*\d{6})\b/g, '');
  return t.replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
}

const getShiftKey = (shift: { userId: string; date: Date | Timestamp; address: string; type?: string }): string => {
  const d = (shift.date as any).toDate ? (shift.date as Timestamp).toDate() : (shift.date as Date);
  if (!d || isNaN(d.getTime())) return `invalid-${shift.userId}-${Math.random()}`;
  // 🔒 MIDDAY UTC ANCHOR
  const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  // 🔒 TASK-FREE KEY: Only who, when, and where
  const addr = normalizeText(shift.address.replace(/\b[BE]\d+\S*\b/gi, ''));
  return `${dateStr}-${shift.userId}-${addr}-${shift.type || 'all'}`;
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
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
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
    setUploadProgress(null);
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
      const visible = workbook.SheetNames.filter(name => !name.startsWith('_'));
      setSheetNames(visible);
      try {
        const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (stored) setSelectedSheets(JSON.parse(stored).filter((s: string) => visible.includes(s)));
        else setSelectedSheets(visible);
      } catch { setSelectedSheets(visible); }
    };
    reader.readAsArrayBuffer(selectedFile);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) processFile(selectedFile);
  };

  const toggleSheet = (sheetName: string) => {
    const next = selectedSheets.includes(sheetName) ? selectedSheets.filter((s) => s !== sheetName) : [...selectedSheets, sheetName];
    setSelectedSheets(next);
    try { localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(next)); } catch (e) {}
  };

  const runImport = useCallback(
    async (commitChanges: boolean) => {
      const firestore = db;
      if (!file || !firestore) { setError('Please select a file first.'); return; }
      setIsUploading(true);
      setUploadProgress('Reading file...');
      setError(null);
      const currentPlannerName = normalizePlannerName(file.name);

      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const data = e.target?.result;
          if (!(data instanceof ArrayBuffer)) throw new Error('Could not read file.');
          const usersSnapshot = await getDocs(collection(firestore, 'users'));
          const userMap: UserMapEntry[] = usersSnapshot.docs.map((d) => {
            const u = d.data() as UserProfile;
            return { uid: d.id, normalizedName: normalizeText(u.name), originalName: u.name, department: u.department, accountType: u.accountType };
          });
          
          const finalDept = importType === 'GAS' ? 'Gas' : importDepartment;
          const result = importType === 'GAS' ? await parseGasWorkbook(Buffer.from(data), userMap) : await parseBuildWorkbook(Buffer.from(data), userMap, selectedSheets);

          const allShiftsFromExcel = result.parsed.map((p: any) => ({
            date: new Date(p.shiftDate),
            address: p.siteAddress,
            task: p.task,
            userId: p.user.uid,
            userName: p.user.originalName,
            type: p.type,
            manager: p.manager || '',
            contract: p.contract || '',
            department: finalDept,
            notes: p.notes || '',
            eNumber: p.eNumber || '',
            plannerName: currentPlannerName, 
          }));

          const existingShiftsSnapshot = await getDocs(query(collection(firestore, 'shifts'), where('department', '==', finalDept)));
          const existingShiftsMap = new Map<string, Shift>();
          existingShiftsSnapshot.docs.forEach((doc) => {
            const shiftData = { id: doc.id, ...doc.data() } as Shift;
            const key = getShiftKey(shiftData as any);
            if (!existingShiftsMap.has(key)) existingShiftsMap.set(key, shiftData);
          });

          const excelShiftsMap = new Map<string, ParsedShift>();
          allShiftsFromExcel.forEach(s => excelShiftsMap.set(getShiftKey(s as any), s));

          const toCreate: ParsedShift[] = [], toUpdate: { old: Shift; new: ParsedShift }[] = [], toDelete: Shift[] = [];
          const protectedStatuses = ['completed', 'incomplete', 'rejected', 'on-site'];

          for (const [key, excelShift] of excelShiftsMap.entries()) {
            const existing = existingShiftsMap.get(key);
            if (!existing) toCreate.push(excelShift);
            else if (!protectedStatuses.includes(existing.status)) {
              if (normalizeText(existing.task) !== normalizeText(excelShift.task) || existing.type !== excelShift.type) {
                toUpdate.push({ old: existing, new: excelShift });
              }
            }
          }

          for (const [key, existing] of existingShiftsMap.entries()) {
            const samePlanner = normalizePlannerName(existing.plannerName) === currentPlannerName;
            if (samePlanner && !excelShiftsMap.has(key) && !protectedStatuses.includes(existing.status) && existing.source !== 'manual') {
                toDelete.push(existing);
            }
          }

          const onConfirm = async () => {
            if (!functions) throw new Error("Functions not ready.");
            await httpsCallable(functions, 'reconcileShifts')({
              toCreate: toCreate.map(s => ({ ...s, date: s.date.toISOString() })),
              toUpdate: toUpdate.map(u => ({ id: u.old.id, new: { ...u.new, date: u.new.date.toISOString() } })),
              toDelete: toDelete.map(s => ({ id: s.id })),
              department: finalDept
            });
            toast({ title: 'Import Complete' });
          };

          if (!commitChanges) {
            onImportComplete(result.failures as any[], onConfirm, { toCreate, toUpdate, toDelete, failed: result.failures as any[], diagnostics: result.diagnostics });
            setIsUploading(false);
            setUploadProgress(null);
            return;
          }
          await onConfirm();
          onImportComplete(result.failures as any[], onConfirm);
          handleClear();
        } catch (err: any) {
          console.error('Import crash:', err);
          if (err.message?.includes('time value')) {
            setError(`Data Quality Diagnostic Error: Your spreadsheet contains non-date data (likely a phone number) in a date column.\n\nInstructions: Columns F onwards should ONLY contain valid dates. Check row 4 or 5 of your sheets for phone numbers.`);
          } else setError(err?.message || 'Processing error.');
          onImportComplete([], async () => {}, undefined);
        } finally { setIsUploading(false); setUploadProgress(null); }
      };
      reader.readAsArrayBuffer(file);
    },
    [file, selectedSheets, toast, onImportComplete, onFileSelect, userProfile, importDepartment, importType]
  );

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <FileWarning className="h-4 w-4" />
          <AlertTitle className="flex items-center gap-2">Import Error <HelpCircle className="h-4 w-4" /></AlertTitle>
          <AlertDescription style={{ whiteSpace: 'pre-wrap' }} className="text-xs leading-relaxed">{error}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-4">
        {!file ? (
          <div onDrop={(e) => { e.preventDefault(); setIsDragOver(false); if(e.dataTransfer.files?.[0]) processFile(e.dataTransfer.files[0]); }} onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }} onDragLeave={() => setIsDragOver(false)} className={cn('flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-lg text-center transition-colors h-48', isDragOver && 'border-primary bg-primary/10')}>
            <UploadCloud className="h-12 w-12 text-muted-foreground" />
            <h3 className="mt-2 text-sm font-medium">Drag & drop Excel file here</h3>
            <Input id="shift-file-input" type="file" accept=".xlsx, .xls, .xlsm" className="sr-only" onChange={handleFileChange} />
            <Button asChild variant="link" className="mt-2"><Label htmlFor="shift-file-input" className="cursor-pointer">Browse file</Label></Button>
          </div>
        ) : (
          <div className="p-4 border rounded-lg space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3"><FileIcon className="h-6 w-6 text-primary" /><div><p className="text-sm font-medium">{file.name}</p></div></div>
              <Button variant="ghost" size="icon" onClick={handleClear} className="text-muted-foreground"><X className="h-5 w-5" /></Button>
            </div>
            {importType === 'BUILD' && sheetNames.length > 0 && (
              <div className="space-y-2">
                <Label>Select Sheets</Label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button variant="outline" className="w-full justify-between"><span className="truncate">{selectedSheets.length} sheets selected</span><ChevronDown className="h-4 w-4 opacity-50" /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]"><ScrollArea className="h-72">{sheetNames.map((name) => (<DropdownMenuCheckboxItem key={name} checked={selectedSheets.includes(name)} onCheckedChange={() => toggleSheet(name)} onSelect={(e) => e.preventDefault()}>{name}</DropdownMenuCheckboxItem>))}</ScrollArea></DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>
        )}
        {file && (
          <div className="flex flex-col sm:flex-row gap-4 pt-2">
            <div className="flex items-center space-x-2"><Checkbox id="dry-run" checked={isDryRun} onCheckedChange={(c) => setIsDryRun(!!c)} /><Label htmlFor="dry-run">Dry Run</Label></div>
            <Button onClick={() => runImport(isDryRun === false)} disabled={!file || isUploading} className="w-full sm:w-auto min-w-[140px]">
              {isUploading ? <Spinner /> : isDryRun ? <><TestTube2 className="mr-2 h-4 w-4" /> Run Test</> : <><Upload className="mr-2 h-4 w-4" /> Import Shifts</>}
            </Button>
            {uploadProgress && <span className="text-xs text-muted-foreground animate-pulse">{uploadProgress}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
