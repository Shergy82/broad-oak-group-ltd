'use client';

import { useState, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import {
  collection,
  writeBatch,
  doc,
  getDocs,
  Timestamp,
  serverTimestamp,
} from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/shared/spinner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Upload, FileWarning, TestTube2, Sheet, ChevronDown } from 'lucide-react';
import type { Shift, UserProfile } from '@/types';
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

/* =========================
   TYPES
========================= */

type ParsedShift = Omit<
  Shift,
  'id' | 'status' | 'date' | 'createdAt' | 'userName' | 'contract'
> & {
  date: Date;
  userName: string;
  contract?: string; // sheet name / contract identifier
};

type UserMapEntry = {
  uid: string;
  normalizedName: string;
  originalName: string;
};

export interface FailedShift {
  date: Date | null;
  projectAddress: string;
  cellContent: string;
  reason: string;
  sheetName: string;
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
}

/* =========================
   HELPERS
========================= */

const levenshtein = (a: string, b: string): number => {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m: number[][] = Array.from({ length: b.length + 1 }, (_, i) => [i]);
  for (let j = 0; j <= a.length; j++) m[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      m[i][j] =
        b[i - 1] === a[j - 1]
          ? m[i - 1][j - 1]
          : Math.min(m[i - 1][j - 1], m[i][j - 1], m[i - 1][j]) + 1;
    }
  }
  return m[b.length][a.length];
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

    if (user.normalizedName.includes(normalizedName) && distance < minDistance) {
      minDistance = distance;
      bestMatch = user;
    }

    const firstNameNormalized = normalizeText(user.originalName.split(' ')[0]);
    if (firstNameNormalized === normalizedName) {
      const d = levenshtein(normalizedName, firstNameNormalized);
      if (d < minDistance) {
        minDistance = d;
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

const parseDate = (value: any): Date | null => {
  if (!value) return null;

  // Excel numeric dates
  if (typeof value === 'number' && value > 1) {
    const excelEpoch = new Date(1899, 11, 30);
    const d = new Date(excelEpoch.getTime() + value * 86400000);
    if (!isNaN(d.getTime())) {
      return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    }
  }

  // JS Date
  if (value instanceof Date && !isNaN(value.getTime())) {
    return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  }

  // Simple "dd-Mon" / "dd Mon"
  if (typeof value === 'string') {
    const match = value.toLowerCase().match(/(\d{1,2})[ -/]([a-z]{3})/);
    if (match) {
      const day = Number(match[1]);
      const month = new Date(`${match[2]} 1, 2012`).getMonth();
      if (!isNaN(day) && month !== -1) {
        return new Date(Date.UTC(new Date().getFullYear(), month, day));
      }
    }
  }

  return null;
};

const LOCAL_STORAGE_KEY = 'shiftImport_selectedSheets';

/* =========================
   COMPONENT
========================= */

export function FileUploader({ onImportComplete, onFileSelect }: FileUploaderProps) {
  const { toast } = useToast();

  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDryRun, setIsDryRun] = useState(true);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheets, setSelectedSheets] = useState<string[]>([]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;

    setFile(selected);
    setError(null);
    onFileSelect();

    const reader = new FileReader();
    reader.onload = ev => {
      const workbook = XLSX.read(ev.target?.result, { type: 'array', bookSheets: true });
      const allSheets = workbook.SheetNames;
      setSheetNames(allSheets);

      // Restore selection
      try {
        const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (stored) {
          const parsed: string[] = JSON.parse(stored);
          const valid = parsed.filter(s => allSheets.includes(s));
          setSelectedSheets(valid.length > 0 ? valid : allSheets.slice(0, 1));
        } else {
          setSelectedSheets(allSheets.slice(0, 1));
        }
      } catch {
        setSelectedSheets(allSheets.slice(0, 1));
      }
    };
    reader.readAsArrayBuffer(selected);
  };

  const toggleSheet = (name: string) => {
    setSelectedSheets(prev => {
      const next = prev.includes(name) ? prev.filter(s => s !== name) : [...prev, name];
      try {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const runImport = useCallback(
    async (commit: boolean) => {
      if (!file || !db) {
        setError('Please select a file first.');
        return;
      }
      if (selectedSheets.length === 0) {
        setError('No sheets selected. Please select at least one sheet.');
        return;
      }

      setIsUploading(true);
      setError(null);

      const reader = new FileReader();
      reader.onload = async e => {
        try {
          const workbook = XLSX.read(e.target?.result, { type: 'array', cellDates: true });

          const usersSnap = await getDocs(collection(db, 'users'));
          const userMap: UserMapEntry[] = usersSnap.docs.map(d => {
            const u = d.data() as UserProfile;
            return { uid: d.id, normalizedName: normalizeText(u.name), originalName: u.name };
          });

          const allShifts: ParsedShift[] = [];
          const failed: FailedShift[] = [];

          for (const sheetName of selectedSheets) {
            const ws = workbook.Sheets[sheetName];
            if (!ws) continue;

            const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: null });

            // This is your simple format: date row is row 0, cells are "Task - Name"
            for (let r = 0; r < rows.length; r++) {
              for (let c = 1; c < (rows[r]?.length || 0); c++) {
                const date = parseDate(rows[0]?.[c]);
                const cell = rows[r]?.[c];
                if (!date || !cell) continue;

                const parts = String(cell).split('-');
                if (parts.length < 2) continue;

                const task = parts[0].trim();
                const name = parts.slice(1).join('-').trim(); // keep names with hyphens

                const user = findUser(name, userMap);

                if (!user) {
                  failed.push({
                    date,
                    projectAddress: '',
                    cellContent: String(cell),
                    reason: `User not found: ${name}`,
                    sheetName,
                  });
                  continue;
                }

                allShifts.push({
                  task,
                  userId: user.uid,
                  userName: user.originalName,
                  type: 'all-day',
                  date,
                  address: '',
                  eNumber: '',
                  manager: '',
                  contract: sheetName, // ✅ fix for App Hosting build
                });
              }
            }
          }

          const onConfirm = async () => {
            const batch = writeBatch(db);
            allShifts.forEach(s => {
              batch.set(doc(collection(db, 'shifts')), {
                ...s,
                date: Timestamp.fromDate(s.date),
                status: 'pending-confirmation',
                createdAt: serverTimestamp(),
              });
            });
            await batch.commit();
          };

          if (!commit) {
            onImportComplete(failed, onConfirm, {
              toCreate: allShifts,
              toUpdate: [],
              toDelete: [],
              failed,
            });
            return;
          }

          await onConfirm();
          onImportComplete(failed, onConfirm);
          toast({ title: 'Import complete' });
        } catch (err: any) {
          setError(err?.message || 'Import failed');
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
    [file, selectedSheets, onImportComplete, toast, onFileSelect]
  );

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <FileWarning className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription style={{ whiteSpace: 'pre-wrap' }}>{error}</AlertDescription>
        </Alert>
      )}

      <Input type="file" accept=".xlsx,.xls" onChange={handleFileChange} />

      {sheetNames.length > 0 && (
        <div className="space-y-2">
          <Label>Select Sheets to Import</Label>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="w-full justify-between">
                {selectedSheets.join(', ') || 'Select sheets'}
                <ChevronDown className="h-4 w-4 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">
              <DropdownMenuLabel>Sheets</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {sheetNames.map(name => (
                <DropdownMenuCheckboxItem
                  key={name}
                  checked={selectedSheets.includes(name)}
                  onCheckedChange={() => toggleSheet(name)}
                  onSelect={e => e.preventDefault()} // keep menu open
                >
                  <Sheet className="mr-2 h-4 w-4" />
                  {name}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      <div className="flex gap-4 items-center">
        <div className="flex items-center space-x-2">
          <Checkbox checked={isDryRun} onCheckedChange={v => setIsDryRun(!!v)} />
          <Label>Dry run</Label>
        </div>

        <Button onClick={() => runImport(!isDryRun)} disabled={!file || isUploading || selectedSheets.length === 0}>
          {isUploading ? (
            <Spinner />
          ) : isDryRun ? (
            <>
              <TestTube2 className="mr-2 h-4 w-4" /> Test
            </>
          ) : (
            <>
              <Upload className="mr-2 h-4 w-4" /> Import
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
