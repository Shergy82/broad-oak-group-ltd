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
 * 🔒 NORMALIZATION HELPERS
 */
function norm(val: any): string {
  return String(val || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getShiftDayKey(value: any): string {
  let d: Date;
  if (value instanceof Date) d = value;
  else if (typeof value?.toDate === 'function') d = value.toDate();
  else if (typeof value === 'object' && value.seconds) d = new Date(value.seconds * 1000);
  else d = new Date(value);
  
  if (isNaN(d.getTime())) return 'invalid';
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Normalizes a filename to a source ID.
 * Ignores suffixes like (1), (2), v1, etc.
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
 * 🔒 STABLE IDENTITY KEY
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
 * 🔒 LEGACY MATCHING LOGIC
 * Compares attributes if importKey/sourceId is missing.
 */
function isLegacyMatch(incoming: StandardShift, existing: Shift): boolean {
  // Must be same person and same day
  if (existing.userId !== incoming.operativeUid) return false;
  if (getShiftDayKey(existing.date) !== getShiftDayKey(incoming.date)) return false;

  // Must be same location and roughly same task intent
  return (
    norm(existing.address) === norm(incoming.address) &&
    norm(existing.type) === norm(incoming.type) &&
    norm(existing.task) === norm(incoming.task)
  );
}

function isTodayOrFuture(value: any): boolean {
  const now = new Date();
  const todayKey = getShiftDayKey(now);
  const shiftKey = getShiftDayKey(value);
  return shiftKey >= todayKey;
}

/**
 * Checks if non-identity fields have changed.
 */
function hasMetadataChanged(existing: any, incoming: StandardShift): boolean {
  return (
    norm(existing.contract) !== norm(incoming.contract) ||
    norm(existing.manager) !== norm(incoming.manager) ||
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

    const sourceId = getPlannerSourceId(file.name);
    const sourceName = file.name;

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
        
        // 3. Prepare incoming shifts
        const incomingShifts = parseResult.shifts
          .filter(s => isTodayOrFuture(s.date))
          .map(s => ({ 
            ...s, 
            department, 
            sourcePlannerId: sourceId,
            sourcePlannerName: sourceName,
            importKey: getImportKey(s, sourceId)
          }));

        // 4. Fetch ALL future shifts for department (to find legacy matches)
        const existingSnap = await getDocs(
          query(
            collection(db, 'shifts'), 
            where('department', '==', department)
          )
        );
        
        const existingShifts = existingSnap.docs
          .map(d => ({ id: d.id, ...d.data() } as Shift))
          .filter(s => isTodayOrFuture(s.date));

        // 5. Reconciliation loop
        const toCreate: any[] = [];
        const toUpdate: any[] = [];
        const toSynced: any[] = [];
        const processedDocIds = new Set<string>();
        const processedKeys = new Set<string>();

        incomingShifts.forEach(incoming => {
          // Skip rows with errors
          if (parseResult.errors.some(err => err.row === incoming.sourceCell && err.severity === 'error')) return;

          // Strategy A: Match by Key
          let match = existingShifts.find(s => s.importKey === incoming.importKey);
          
          // Strategy B: Match by Legacy Attributes
          if (!match) {
            match = existingShifts.find(s => !s.importKey && isLegacyMatch(incoming, s));
          }

          if (!match) {
            toCreate.push(incoming);
          } else {
            processedDocIds.add(match.id);
            processedKeys.add(incoming.importKey);

            const needsBackfill = !match.importKey || !match.sourcePlannerId;
            const needsUpdate = hasMetadataChanged(match, incoming);

            if (needsUpdate || needsBackfill) {
              toUpdate.push({ id: match.id, old: match, new: incoming });
            } else {
              toSynced.push(match);
            }
          }
        });

        // 6. Identify deletions (In Firestore for THIS SOURCE, but missing in current Excel)
        const toDelete = existingShifts.filter(s => 
          s.sourcePlannerId === sourceId && 
          !processedDocIds.has(s.id)
        );

        onImportComplete({
          toCreate,
          toUpdate,
          toDelete,
          toSynced,
          toIssues: parseResult.errors.filter(err => err.severity === 'error'),
          profileId: sourceId,
          profileName: sourceName,
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
            <p className="text-sm font-medium animate-pulse text-muted-foreground">Reconciling schedule...</p>
          </div>
        ) : (
          <>
            <div className="bg-primary/10 p-4 rounded-full mb-4">
              <UploadCloud className="h-8 w-8 text-primary" />
            </div>
            <h3 className="text-lg font-semibold">Upload {title}</h3>
            <p className="text-sm text-muted-foreground mb-4 text-center px-4">
              The system will automatically recognize already published shifts.
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
