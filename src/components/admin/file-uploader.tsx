'use client';

import { useState, useRef } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/shared/spinner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { UploadCloud, FileWarning } from 'lucide-react';
import { cn } from '@/lib/utils';
import { parseWorkbook, type UnifiedParseResult } from '@/lib/exceljs-parser';
import { type UserMapEntry, type StandardShift } from '@/lib/importer/types';
import type { UserProfile, Shift } from '@/types';
import { Label } from '../ui/label';

interface FileUploaderProps {
  title: string;
  department: string;
  onImportComplete: (
    result: UnifiedParseResult & {
      toCreate: StandardShift[];
      toUpdate: { id: string; old: Shift; new: StandardShift }[];
      toDelete: Shift[];
      toUnchanged: Shift[];
    }
  ) => void;
  onFileSelect: () => void;
  userProfile: UserProfile;
}

/**
 * 🔒 IDENTITY KEY GENERATION
 * Used to uniquely identify a shift: Dept + User + Date + Normalized Address + Shift Type.
 */
function getShiftIdentityKey(shift: any, department: string): string {
  const dept = normalizeText(department);
  const userId = String(shift.userId || shift.operativeUid || '').trim();
  const dateStr = getShiftDayKey(shift.date);
  const address = normalizeText(shift.address);
  const type = normalizeText(shift.type || 'all-day');

  return [dept, userId, dateStr, address, type].join('|');
}

function normalizeText(text: string | null | undefined): string {
  if (!text) return '';
  return String(text)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getShiftDayKey(value: any): string {
  let d: Date;
  if (value instanceof Date) {
    d = value;
  } else if (typeof value?.toDate === 'function') {
    d = value.toDate();
  } else {
    d = new Date(value);
  }
  
  if (isNaN(d.getTime())) return 'invalid-date';

  return [
    d.getUTCFullYear(),
    String(d.getUTCMonth() + 1).padStart(2, '0'),
    String(d.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function isTodayOrFuture(value: any): boolean {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const todayKey = getShiftDayKey(now);
  const shiftKey = getShiftDayKey(value);
  return shiftKey >= todayKey;
}

function hasDataChanged(existing: any, incoming: StandardShift): boolean {
  const norm = (val: any) => normalizeText(String(val || '').trim());
  
  return (
    norm(existing.task) !== norm(incoming.task) ||
    norm(existing.manager) !== norm(incoming.manager) ||
    norm(existing.contract) !== norm(incoming.contract) ||
    norm(existing.eNumber) !== norm(incoming.eNumber) ||
    norm(existing.notes) !== norm(incoming.notes)
  );
}

export function FileUploader({
  title,
  department,
  onImportComplete,
  onFileSelect,
}: FileUploaderProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = async (file: File) => {
    setIsProcessing(true);
    setError(null);
    onFileSelect();

    // 🔒 Standardize Source ID based on filename
    const profileId = file.name.toLowerCase().replace(/[^a-z0-9]/g, '-');

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const buffer = e.target?.result;
        if (!(buffer instanceof ArrayBuffer)) throw new Error('Could not read file.');

        // 1. Fetch search context
        const usersSnap = await getDocs(collection(db, 'users'));
        const userMap: UserMapEntry[] = usersSnap.docs.map(doc => {
          const u = doc.data() as any;
          return {
            uid: u.authUid || u.fireAuthUid || doc.id,
            originalName: u.name,
            normalizedName: (u.name || "").toLowerCase().replace(/[^a-z0-9]/g, ''),
            department: u.department,
          };
        });

        // 2. Parse workbook
        const parseResult = await parseWorkbook(Buffer.from(buffer), userMap);
        
        // 3. Filter for Today+ and attach department
        const incomingShifts = parseResult.shifts
          .filter(s => isTodayOrFuture(s.date))
          .map(s => ({ ...s, department, plannerName: profileId }));

        // 4. SCOPED SYNC: Fetch only shifts previously created by THIS planner
        const existingSnap = await getDocs(
          query(
            collection(db, 'shifts'), 
            where('department', '==', department),
            where('plannerName', '==', profileId),
            where('source', '==', 'import')
          )
        );
        
        const existingMap = new Map<string, Shift>();
        existingSnap.docs.forEach(docSnap => {
          const data = docSnap.data();
          if (isTodayOrFuture(data.date)) {
            const key = getShiftIdentityKey(data, department);
            existingMap.set(key, { id: docSnap.id, ...data } as Shift);
          }
        });

        // 5. Compare logic
        const toCreate: StandardShift[] = [];
        const toUpdate: { id: string; old: Shift; new: StandardShift }[] = [];
        const toUnchanged: Shift[] = [];
        const consumedExistingIds = new Set<string>();

        incomingShifts.forEach(incoming => {
          const key = getShiftIdentityKey(incoming, department);
          const existing = existingMap.get(key);

          if (!existing) {
            toCreate.push(incoming);
          } else {
            consumedExistingIds.add(existing.id);
            if (hasDataChanged(existing, incoming)) {
              toUpdate.push({ id: existing.id, old: existing, new: incoming });
            } else {
              toUnchanged.push(existing);
            }
          }
        });

        // 6. Identify deletions (In DB from THIS planner but missing from current file)
        const toDelete: Shift[] = [];
        existingMap.forEach(existing => {
          if (!consumedExistingIds.has(existing.id)) {
            toDelete.push(existing);
          }
        });

        onImportComplete({
          ...parseResult,
          toCreate,
          toUpdate,
          toDelete,
          toUnchanged,
          profileId,
        });

        // Reset input for immediate re-use
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      } catch (err: any) {
        console.error('Processing error:', err);
        setError(err.message || 'An unexpected error occurred.');
      } finally {
        setIsProcessing(false);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <FileWarning className="h-4 w-4" />
          <AlertTitle>Import Error</AlertTitle>
          <AlertDescription className="text-xs whitespace-pre-wrap">{error}</AlertDescription>
        </Alert>
      )}

      <div
        onDrop={(e) => { e.preventDefault(); setIsDragOver(false); if (e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]); }}
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        className={cn(
          'flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-xl h-64 transition-all',
          isDragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/20 hover:border-primary/40'
        )}
      >
        {isProcessing ? (
          <div className="flex flex-col items-center gap-3">
            <Spinner size="lg" />
            <p className="text-sm font-medium animate-pulse text-muted-foreground">Scanning spreadsheet...</p>
          </div>
        ) : (
          <>
            <div className="bg-primary/10 p-4 rounded-full mb-4">
              <UploadCloud className="h-8 w-8 text-primary" />
            </div>
            <h3 className="text-lg font-semibold">Upload {title}</h3>
            <p className="text-sm text-muted-foreground mb-4 text-center px-4">
              Drag your workbook here or click below to start identifying shifts.
            </p>
            <Input
              ref={fileInputRef}
              id={`shift-file-input-${department}`}
              type="file"
              accept=".xlsx,.xls,.xlsm"
              className="sr-only"
              onChange={(e) => { if (e.target.files?.[0]) processFile(e.target.files[0]); }}
            />
            <Button asChild variant="outline">
              <Label htmlFor={`shift-file-input-${department}`} className="cursor-pointer">
                Choose Excel File
              </Label>
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
