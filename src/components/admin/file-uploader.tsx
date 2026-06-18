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
  ChevronDown,
  X,
  UploadCloud,
  HelpCircle,
} from 'lucide-react';
import type { Shift, UserProfile } from '@/types';
import { Checkbox } from '../ui/checkbox';
import { Label } from '../ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '../ui/scroll-area';
import { cn } from '@/lib/utils';
import { parseGasWorkbook, parseBuildWorkbook, type ImportType, type DiagnosticIssue } from '@/lib/exceljs-parser';

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
  date: string | null;
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

/**
 * 🔒 PLANNER SCOPE NORMALIZER
 * Strips extensions and download numbers like (43) or (1)
 */
function normalizePlannerName(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .replace(/\.[^/.]+$/, "") // remove extension
    .replace(/\s*\(\d+\)$/, "") // remove trailing (number)
    .toLowerCase()
    .trim();
}

function normalizeText(text: string | null | undefined): string {
  if (!text) return "";
  let t = String(text).toLowerCase();
  // Strip phone numbers
  t = t.replace(/\b(0\d{3,4}\s*\d{5,6}|07\d{3}\s*\d{6}|\+44\s*\d{4}\s*\d{6})\b/g, '');
  return t.replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * 🔒 STABLE IDENTITY KEY
 * Identify shifts by Who + When + Where. 
 * Task description is EXCLUDED so updates are recognized as edits.
 */
const getShiftKey = (shift: { userId: string; date: Date | Timestamp; address: string; type?: string }): string => {
  const d = (shift.date as any).toDate ? (shift.date as Timestamp).toDate() : (shift.date as Date);
  if (!d || isNaN(d.getTime())) return `invalid-${shift.userId}-${Math.random()}`;
  
  // Use Midday UTC to prevent any timezone shifts during comparison
  const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  
  // Clean address for matching: remove E-numbers/B-numbers and postcodes
  const cleanAddr = (shift.address || "").replace(/\b[BE]\d+\S*\b/gi, '').replace(/\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/gi, '');
  const addrNorm = normalizeText(cleanAddr);
  
  return `${dateStr}-${shift.userId}-${addrNorm}-${shift.type || 'all'}`;
};

interface FileUploaderProps {
  onImportComplete: (failedShifts: FailedShift[], onConfirm: () => Promise<void>, dryRunResult?: DryRunResult) => void;
  onFileSelect: () => void;
  userProfile: UserProfile;
  importDepartment: string;
  importType: ImportType;
}

const LOCAL_STORAGE_KEY = 'shiftImport_selectedSheets_v3';

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

  const runImport = useCallback(
    async (commitChanges: boolean) => {
      if (!file || !db) return;
      setIsUploading(true);
      setUploadProgress('Analyzing data...');
      setError(null);
      
      const currentPlannerNormalized = normalizePlannerName(file.name);

      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const data = e.target?.result;
          if (!(data instanceof ArrayBuffer)) throw new Error('Could not read file.');
          
          const usersSnapshot = await getDocs(collection(db, 'users'));
          const userMap: UserMapEntry[] = usersSnapshot.docs.map((d) => {
            const u = d.data() as UserProfile;
            return { uid: d.id, normalizedName: normalizeText(u.name), originalName: u.name, department: u.department };
          });
          
          const finalDept = importType === 'GAS' ? 'Gas' : importDepartment;
          const result = importType === 'GAS' ? await parseGasWorkbook(Buffer.from(data), userMap) : await parseBuildWorkbook(Buffer.from(data), userMap, selectedSheets);

          const excelShifts = result.parsed.map(p => ({ ...p, date: new Date(p.shiftDate), plannerName: file.name }));
          const excelKeys = new Set(excelShifts.map(s => getShiftKey(s)));

          // Fetch only shifts for this department to optimize comparison
          const existingSnapshot = await getDocs(query(collection(db, 'shifts'), where('department', '==', finalDept)));
          const existingMap = new Map<string, Shift>();
          existingSnapshot.docs.forEach(d => {
            const s = { id: d.id, ...d.data() } as Shift;
            existingMap.set(getShiftKey(s as any), s);
          });

          const toCreate: ParsedShift[] = [], toUpdate: { old: Shift; new: ParsedShift }[] = [], toDelete: Shift[] = [];
          const protectedStatuses = ['completed', 'incomplete', 'rejected', 'on-site'];

          excelShifts.forEach(ex => {
            const key = getShiftKey(ex);
            const ext = existingMap.get(key);
            if (!ext) {
                toCreate.push(ex as any);
            } else if (!protectedStatuses.includes(ext.status)) {
                // Identity match (Key matches) but content changed (Task/Note)
                // This correctly identifies "Updates" now that task isn't in the key
                if (normalizeText(ext.task) !== normalizeText(ex.task) || ext.type !== ex.type) {
                    toUpdate.push({ old: ext, new: ex as any });
                }
            }
          });

          /**
           * 🔒 PLANNER SCOPE SHIELD
           * Only delete shifts that were imported from variations of THIS planner.
           * e.g. "Unitas (43)" should only replace work from "Unitas".
           */
          existingMap.forEach((ext, key) => {
            const extPlannerNorm = normalizePlannerName(ext.plannerName);
            const isSamePlanner = extPlannerNorm === currentPlannerNormalized;
            
            if (isSamePlanner && !excelKeys.has(key) && !protectedStatuses.includes(ext.status) && ext.source !== 'manual') {
                toDelete.push(ext);
            }
          });

          const onConfirm = async () => {
            if (!functions) return;
            await httpsCallable(functions, 'reconcileShifts')({
              toCreate: toCreate.map(s => ({ ...s, date: s.date.toISOString() })),
              toUpdate: toUpdate.map(u => ({ id: u.old.id, new: { ...u.new, date: u.new.date.toISOString() } })),
              toDelete: toDelete.map(s => ({ id: s.id })),
              department: finalDept
            });
            toast({ title: 'Import Successful' });
          };

          if (!commitChanges) {
            onImportComplete(result.failures as any[], onConfirm, { toCreate, toUpdate, toDelete, failed: result.failures as any[], diagnostics: result.diagnostics });
          } else {
            await onConfirm();
            handleClear();
          }
        } catch (err: any) {
          console.error('Import error:', err);
          if (err.message?.includes('time value')) {
            setError(`Data Quality Alert: A phone number was detected in a date column.\n\nAction: Ensure columns F onwards only contain dates in row 4 or 5.`);
          } else {
            setError(err.message || 'Import failed.');
          }
          onImportComplete([], async () => {}, undefined);
        } finally { 
          setIsUploading(false); 
          setUploadProgress(null); 
        }
      };
      reader.readAsArrayBuffer(file);
    },
    [file, selectedSheets, toast, onImportComplete, onFileSelect, importDepartment, importType]
  );

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <FileWarning className="h-4 w-4" />
          <AlertTitle className="flex items-center gap-2">Processing Error <HelpCircle className="h-4 w-4" /></AlertTitle>
          <AlertDescription className="text-xs whitespace-pre-wrap">{error}</AlertDescription>
        </Alert>
      )}
      {!file ? (
        <div onDrop={(e) => { e.preventDefault(); setIsDragOver(false); if(e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]); }} onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }} onDragLeave={() => setIsDragOver(false)} className={cn('flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-lg h-48 transition-colors', isDragOver && 'border-primary bg-primary/10')}>
          <UploadCloud className="h-12 w-12 text-muted-foreground" />
          <h3 className="mt-2 text-sm font-medium">Drag & drop Excel file here</h3>
          <Input id="shift-file-input" type="file" accept=".xlsx,.xls,.xlsm" className="sr-only" onChange={(e) => e.target.files?.[0] && processFile(e.target.files[0])} />
          <Button asChild variant="link" className="mt-2"><Label htmlFor="shift-file-input" className="cursor-pointer">Browse file</Label></Button>
        </div>
      ) : (
        <div className="p-4 border rounded-lg space-y-4 bg-muted/30">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium truncate max-w-[250px]">{file.name}</span>
            <Button variant="ghost" size="icon" onClick={handleClear}><X className="h-4 w-4" /></Button>
          </div>
          {importType === 'BUILD' && sheetNames.length > 0 && (
            <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="outline" className="w-full justify-between">{selectedSheets.length} sheets selected <ChevronDown className="ml-2 h-4 w-4" /></Button></DropdownMenuTrigger>
                <DropdownMenuContent className="w-[300px]"><ScrollArea className="h-72">{sheetNames.map(n => (<DropdownMenuCheckboxItem key={n} checked={selectedSheets.includes(n)} onCheckedChange={(c) => setSelectedSheets(p => c ? [...p, n] : p.filter(s => s !== n))} onSelect={e => e.preventDefault()}>{n}</DropdownMenuCheckboxItem>))}</ScrollArea></DropdownMenuContent>
            </DropdownMenu>
          )}
          <div className="flex flex-col sm:flex-row gap-4 pt-2">
            <div className="flex items-center space-x-2"><Checkbox id="dry-run" checked={isDryRun} onCheckedChange={(c) => setIsDryRun(!!c)} /><Label htmlFor="dry-run">Dry Run (Test Only)</Label></div>
            <Button onClick={() => runImport(!isDryRun)} disabled={isUploading} className="flex-1">{isUploading ? <Spinner /> : isDryRun ? <><TestTube2 className="mr-2 h-4 w-4" /> Run Test</> : <><Upload className="mr-2 h-4 w-4" /> Final Import</>}</Button>
          </div>
          {uploadProgress && <p className="text-xs text-center text-muted-foreground animate-pulse">{uploadProgress}</p>}
        </div>
      )}
    </div>
  );
}
