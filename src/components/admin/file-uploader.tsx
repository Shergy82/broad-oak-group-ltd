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
import { parseWorkbook } from '@/lib/exceljs-parser';
import { type UserMapEntry, type StandardShift } from '@/lib/importer/types';
import type { UserProfile, Shift } from '@/types';
import { Label } from '../ui/label';

interface FileUploaderProps {
  title: string;
  department: string;
  onImportComplete: (result: any) => void;
  onFileSelect: () => void;
  userProfile: UserProfile;
}

/**
 * Normalizes a filename to a source ID.
 * Unitas (1).xlsx -> unitas
 */
function getPlannerSourceId(filename: string): string {
  return filename
    .toLowerCase()
    .replace(/\.[^/.]+$/, "") // remove extension
    .replace(/[\s\-_]v\d+$/i, "") // remove v1, v2
    .replace(/\s\(\d+\)$/, "") // remove (1), (2)
    .replace(/[^a-z0-9]/g, "-") // sanitize
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Normalizes a string for comparison.
 */
function norm(val: any): string {
  return String(val || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Generates a stable identity key for a shift.
 */
function getImportKey(shift: any, sourceId: string): string {
  const parts = [
    sourceId,
    shift.operativeUid || shift.userId || '',
    getShiftDayKey(shift.date),
    norm(shift.startTime),
    norm(shift.endTime),
    norm(shift.address),
    norm(shift.task),
    norm(shift.room)
  ];
  return parts.join('|');
}

/**
 * TIMEZONE-SAFE DATE KEY
 */
function getShiftDayKey(value: any): string {
  let d: Date;
  if (value instanceof Date) {
    d = value;
  } else if (typeof value?.toDate === 'function') {
    d = value.toDate();
  } else if (typeof value === 'object' && value.seconds) {
    d = new Date(value.seconds * 1000);
  } else {
    d = new Date(value);
  }
  
  if (isNaN(d.getTime())) return 'invalid-date';

  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  
  return `${y}-${m}-${day}`;
}

function isTodayOrFuture(value: any): boolean {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const todayKey = getShiftDayKey(now);
  const shiftKey = getShiftDayKey(value);
  return shiftKey >= todayKey;
}

/**
 * Checks if metadata (non-identity fields) has changed.
 */
function hasMetadataChanged(existing: any, incoming: StandardShift): boolean {
  return (
    norm(existing.contract) !== norm(incoming.contract) ||
    norm(existing.manager) !== norm(incoming.manager) ||
    norm(existing.eNumber) !== norm(incoming.eNumber) ||
    norm(existing.descriptionOfWorks) !== norm(incoming.descriptionOfWorks)
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

    const sourcePlannerId = getPlannerSourceId(file.name);
    const sourcePlannerName = file.name;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const buffer = e.target?.result;
        if (!(buffer instanceof ArrayBuffer)) throw new Error('Could not read file.');

        // 1. Fetch user search context
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
        
        // 3. Filter for active shifts and generate import keys
        const incomingShifts = parseResult.shifts
          .filter(s => isTodayOrFuture(s.date))
          .map(s => ({ 
            ...s, 
            department, 
            sourcePlannerId,
            sourcePlannerName,
            importKey: getImportKey(s, sourcePlannerId)
          }));

        // 4. FETCH EXISTING SCOPED BY PLANNER ID
        const existingSnap = await getDocs(
          query(
            collection(db, 'shifts'), 
            where('sourcePlannerId', '==', sourcePlannerId),
            where('department', '==', department)
          )
        );
        
        const existingMap = new Map<string, Shift>();
        existingSnap.docs.forEach(docSnap => {
          const data = docSnap.data();
          if (isTodayOrFuture(data.date)) {
            const key = data.importKey || getImportKey(data, sourcePlannerId);
            existingMap.set(key, { id: docSnap.id, ...data } as Shift);
          }
        });

        // 5. Categorize into 5 buckets
        const toCreate: any[] = [];
        const toUpdate: any[] = [];
        const toSynced: any[] = [];
        const toIssues = parseResult.errors.filter(err => err.severity === 'error');
        
        const processedKeys = new Set<string>();

        incomingShifts.forEach(incoming => {
          // Skip if there's a validation error for this specific row in parsing
          const rowIssues = parseResult.errors.filter(err => err.row === incoming.sourceCell && err.severity === 'error');
          if (rowIssues.length > 0) return;

          const key = incoming.importKey;
          const existing = existingMap.get(key);

          if (!existing) {
            toCreate.push(incoming);
          } else {
            processedKeys.add(key);
            if (hasMetadataChanged(existing, incoming)) {
              toUpdate.push({ id: existing.id, old: existing, new: incoming });
            } else {
              toSynced.push(existing);
            }
          }
        });

        // 6. Identify deletions (In Firestore but not in Planner)
        const toDelete: Shift[] = [];
        existingMap.forEach((existing, key) => {
          if (!processedKeys.has(key)) {
            toDelete.push(existing);
          }
        });

        onImportComplete({
          toCreate,
          toUpdate,
          toDelete,
          toSynced,
          toIssues,
          profileId: sourcePlannerId,
          profileName: sourcePlannerName,
        });

        if (fileInputRef.current) fileInputRef.current.value = '';

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
            <p className="text-sm font-medium animate-pulse text-muted-foreground">Scoping shifts...</p>
          </div>
        ) : (
          <>
            <div className="bg-primary/10 p-4 rounded-full mb-4">
              <UploadCloud className="h-8 w-8 text-primary" />
            </div>
            <h3 className="text-lg font-semibold">Upload {title}</h3>
            <p className="text-sm text-muted-foreground mb-4 text-center px-4">
              Reconcile your spreadsheet against existing Firestore shifts.
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
