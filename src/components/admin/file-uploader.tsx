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
 * 🔒 ROBUST NORMALIZATION HELPERS
 */
function norm(val: any): string {
  return String(val || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getShiftDateKey(value: any): string {
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
 * Normalises a filename to a stable Source ID.
 * Strips extensions and desktop suffixes like (1), (2), (12).
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
 * Generates a strong identity key for a shift.
 * Must be consistent every time the same row is imported.
 */
function getShiftIdentityKey(shift: any, sourceId: string): string {
  const parts = [
    norm(sourceId),
    norm(shift.operativeUid || shift.userId),
    getShiftDateKey(shift.date),
    norm(shift.type || 'all-day'),
    norm(shift.address),
    norm(shift.task),
    norm(shift.eNumber),
    norm(shift.contract),
    norm(shift.startTime),
    norm(shift.endTime),
    norm(shift.room)
  ];
  return parts.join('|');
}

/**
 * 🔒 LEGACY FALLBACK MATCHING
 * Used to identify shifts published before the robust identity key system existed.
 */
function isLegacyMatch(incoming: StandardShift, existing: Shift): boolean {
  // Use normalized address, dateKey, and user as the core fallback
  const existingDateKey = existing.dateKey || getShiftDateKey(existing.date);
  const incomingDateKey = getShiftDateKey(incoming.date);

  // If the operative UID matches, the date matches, and the address matches, it's likely the same job.
  return (
    norm(existing.userId) === norm(incoming.operativeUid) &&
    existingDateKey === incomingDateKey &&
    norm(existing.address) === norm(incoming.address) &&
    norm(existing.type) === norm(incoming.type) &&
    norm(existing.task) === norm(incoming.task)
  );
}

/**
 * Checks if metadata fields have genuinely changed compared to existing Firestore record.
 */
function hasChanges(existing: any, incoming: StandardShift, incomingKey: string): boolean {
  // If the stored shift is missing identity fields, it's considered changed (needs backfill)
  if (!existing.importKey || !existing.sourcePlannerId || existing.importKey !== incomingKey) {
    return true;
  }
  
  return (
    norm(existing.manager) !== norm(incoming.manager) ||
    norm(existing.contract) !== norm(incoming.contract) ||
    norm(existing.descriptionOfWorks) !== norm(incoming.descriptionOfWorks) ||
    norm(existing.eNumber) !== norm(incoming.eNumber) ||
    norm(existing.task) !== norm(incoming.task) ||
    norm(existing.startTime) !== norm(incoming.startTime) ||
    norm(existing.endTime) !== norm(incoming.endTime) ||
    norm(existing.room) !== norm(incoming.room)
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
    const sourceName = file.name.replace(/\.[^/.]+$/, "").replace(/\s\(\d+\)$/, ""); // Clean display name

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
        
        // 3. Prepare incoming shifts with new robust IDs
        const incomingShifts = parseResult.shifts.map(s => {
          const dateKey = getShiftDateKey(s.date);
          const importKey = getShiftIdentityKey(s, sourceId);
          
          return { 
            ...s, 
            department, 
            sourcePlannerId: sourceId,
            sourcePlannerName: sourceName,
            plannerName: sourceName, // legacy alias
            profileId: sourceId,     // legacy alias
            dateKey,
            importKey
          };
        });

        // 4. Fetch EXISTING shifts for THIS SOURCE ONLY
        const existingSnap = await getDocs(
          query(
            collection(db, 'shifts'), 
            where('sourcePlannerId', '==', sourceId)
          )
        );
        
        const existingBySource = existingSnap.docs.map(d => ({ id: d.id, ...d.data() } as Shift));

        // 5. Fallback: Fetch legacy shifts (no sourcePlannerId) within same department
        const legacySnap = await getDocs(
          query(
            collection(db, 'shifts'),
            where('department', '==', department),
            where('source', '==', 'import')
          )
        );
        
        const legacyShifts = legacySnap.docs
          .map(d => ({ id: d.id, ...d.data() } as Shift))
          .filter(s => !s.sourcePlannerId || s.sourcePlannerId === "");

        // 6. Reconciliation logic
        const toCreate: any[] = [];
        const toUpdate: any[] = [];
        const toSynced: any[] = [];
        const matchedDocIds = new Set<string>();

        incomingShifts.forEach(incoming => {
          // Skip invalid rows
          if (parseResult.errors.some(err => err.row === incoming.sourceCell && err.severity === 'error')) return;

          // Search Strategy A: Match by Import Key
          let match = existingBySource.find(s => s.importKey === incoming.importKey);
          
          // Search Strategy B: Fallback to Legacy Matching (for old shifts missing keys)
          if (!match) {
            match = legacyShifts.find(s => !matchedDocIds.has(s.id) && isLegacyMatch(incoming, s));
          }

          if (!match) {
            toCreate.push(incoming);
          } else {
            matchedDocIds.add(match.id);
            
            // Check if fields or identity markers need updating/backfilling
            if (hasChanges(match, incoming, incoming.importKey)) {
              toUpdate.push({ id: match.id, old: match, new: incoming });
            } else {
              toSynced.push(match);
            }
          }
        });

        // 7. Identify deletions (Existing in Firestore for THIS SOURCE, but missing in current Excel)
        const toDelete = existingBySource.filter(s => !matchedDocIds.has(s.id));

        onImportComplete({
          toCreate,
          toUpdate,
          toDelete,
          toSynced,
          toIssues: parseResult.errors.filter(err => err.severity === 'error'),
          profileId: sourceId,
          profileName: sourceName,
        });

        // 8. IMPORTANT: Clear file input so it can be re-selected
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
              Upload your Excel file. Identical shifts already on the system will be ignored.
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