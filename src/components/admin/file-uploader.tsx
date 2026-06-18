'use client';

import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
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
  onImportComplete: (
    result: UnifiedParseResult & {
      toCreate: StandardShift[];
      toUpdate: { id: string; old: Shift; new: StandardShift }[];
      toDelete: Shift[];
    }
  ) => void;
  onFileSelect: () => void;
  userProfile: UserProfile;
}

function normalizeText(text: string | null | undefined): string {
  if (!text) return '';

  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePlannerName(fileName: string): string {
  return normalizeText(
    fileName
      .replace(/\.[^/.]+$/, '')
      .replace(/\s*\(\d+\)\s*$/, '')
  );
}

function toDate(value: any): Date {
  if (!value) {
    throw new Error('Invalid date: empty value');
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error('Invalid date: bad Date object');
    }

    return value;
  }

  if (typeof value?.toDate === 'function') {
    const d = value.toDate();

    if (Number.isNaN(d.getTime())) {
      throw new Error('Invalid date: bad Firestore Timestamp');
    }

    return d;
  }

  if (typeof value === 'object' && typeof value.seconds === 'number') {
    return new Date(value.seconds * 1000);
  }

  if (typeof value === 'object' && typeof value._seconds === 'number') {
    return new Date(value._seconds * 1000);
  }

  const d = new Date(value);

  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid date: ${JSON.stringify(value)}`);
  }

  return d;
}

function todayStart(): Date {
  const now = new Date();

  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function dayKey(value: any): string {
  const d = toDate(value);

  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

function shiftKey(shift: any, department: string): string {
  const userId = shift.userId || shift.operativeUid || '';

  return [department, userId, dayKey(shift.date)].join('|');
}

function clean(value: any): string {
  if (value === null || value === undefined) return '';

  return String(value);
}

function hasChanged(existing: any, incoming: StandardShift): boolean {
  return (
    clean(existing.userId) !== clean(incoming.operativeUid) ||
    clean(existing.userName) !== clean(incoming.operative) ||
    clean(existing.operativeUid) !== clean(incoming.operativeUid) ||
    clean(existing.operative) !== clean(incoming.operative) ||
    clean(existing.address) !== clean(incoming.address) ||
    clean(existing.task) !== clean(incoming.task) ||
    clean(existing.type || 'all-day') !== clean(incoming.type || 'all-day') ||
    clean(existing.eNumber) !== clean(incoming.eNumber) ||
    clean(existing.contract) !== clean(incoming.contract) ||
    clean(existing.manager) !== clean(incoming.manager)
  );
}

export function FileUploader({
  onImportComplete,
  onFileSelect,
  userProfile,
}: FileUploaderProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const { toast } = useToast();

  const processFile = async (file: File) => {
    setIsProcessing(true);
    setError(null);
    onFileSelect();

    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        const buffer = e.target?.result;

        if (!(buffer instanceof ArrayBuffer)) {
          throw new Error('Could not read file.');
        }

        const department = userProfile.department || 'Gas';
        const plannerName = normalizePlannerName(file.name);

        const usersSnap = await getDocs(collection(db, 'users'));

        const userMap: UserMapEntry[] = usersSnap.docs.map((doc) => {
          const u = doc.data() as any;

          return {
            uid: u.authUid || u.fireAuthUid || doc.id,
            originalName: u.name,
            normalizedName: (u.name || '').toLowerCase().replace(/[^a-z]/g, ''),
            department: u.department,
          };
        });

        const parseResult = await parseWorkbook(Buffer.from(buffer), userMap);

        const start = todayStart();

        const parsedFutureShifts = parseResult.shifts.filter((shift) => {
          const d = toDate(shift.date);
          return d >= start;
        });

        const existingSnap = await getDocs(
          query(
            collection(db, 'shifts'),
            where('department', '==', department),
            where('source', '==', 'import'),
            where('profileId', '==', plannerName)
          )
        );

        const existingByKey = new Map<string, { id: string; data: any }>();

        existingSnap.docs.forEach((doc) => {
          const data = doc.data() as any;
          let existingDate: Date;

          try {
            existingDate = toDate(data.date);
          } catch {
            return;
          }

          if (existingDate < start) return;

          const key = shiftKey(data, department);
          existingByKey.set(key, {
            id: doc.id,
            data,
          });
        });

        const incomingKeys = new Set<string>();
        const toCreate: StandardShift[] = [];
        const toUpdate: { id: string; old: Shift; new: StandardShift }[] = [];

        for (const shift of parsedFutureShifts) {
          if (!shift.operativeUid) {
            continue;
          }

          const key = shiftKey(shift, department);
          incomingKeys.add(key);

          const existing = existingByKey.get(key);

          if (!existing) {
            toCreate.push(shift);
            continue;
          }

          if (hasChanged(existing.data, shift)) {
            toUpdate.push({
              id: existing.id,
              old: {
                id: existing.id,
                ...existing.data,
              } as Shift,
              new: shift,
            });
          }
        }

        const toDelete: Shift[] = [];

        existingByKey.forEach((existing, key) => {
          if (!incomingKeys.has(key)) {
            toDelete.push({
              id: existing.id,
              ...existing.data,
            } as Shift);
          }
        });

        onImportComplete({
          ...parseResult,
          shifts: parsedFutureShifts,
          toCreate,
          toUpdate,
          toDelete,
          profileId: plannerName,
        });
      } catch (err: any) {
        console.error('Processing error:', err);
        setError(err.message || 'An unexpected error occurred during processing.');
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
          <AlertTitle>Processing Error</AlertTitle>
          <AlertDescription className="text-xs whitespace-pre-wrap">
            {error}
          </AlertDescription>
        </Alert>
      )}

      <div
        onDrop={(e) => {
          e.preventDefault();
          setIsDragOver(false);

          if (e.dataTransfer.files[0]) {
            processFile(e.dataTransfer.files[0]);
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        className={cn(
          'flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-xl h-64 transition-all',
          isDragOver
            ? 'border-primary bg-primary/5'
            : 'border-muted-foreground/20 hover:border-primary/40'
        )}
      >
        {isProcessing ? (
          <div className="flex flex-col items-center gap-3">
            <Spinner size="lg" />
            <p className="text-sm font-medium animate-pulse">
              Mapping operatives...
            </p>
          </div>
        ) : (
          <>
            <div className="bg-primary/10 p-4 rounded-full mb-4">
              <UploadCloud className="h-8 w-8 text-primary" />
            </div>

            <h3 className="text-lg font-semibold">Upload Gas Planner</h3>

            <p className="text-sm text-muted-foreground mb-4 text-center">
              Identifying addresses and assigning staff.
            </p>

            <Input
              id="shift-file-input"
              type="file"
              accept=".xlsx,.xls,.xlsm"
              className="sr-only"
              onChange={(e) => {
                if (e.target.files?.[0]) {
                  processFile(e.target.files[0]);
                }
              }}
            />

            <Button asChild variant="outline">
              <Label htmlFor="shift-file-input" className="cursor-pointer">
                Select Excel File
              </Label>
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
