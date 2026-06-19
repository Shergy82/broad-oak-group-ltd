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

/**
 * 🔒 ROBUST NORMALIZATION ENGINE
 */
function normalize(val: any): string {
  return String(val || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s/g, '-');
}

/**
 * Normalizes planner filename to a stable source ID
 * "TEST (2).xlsx" -> "test"
 * "Unitas (1).xlsx" -> "unitas"
 */
function getPlannerId(filename: string): string {
  return filename
    .toLowerCase()
    .replace(/\.[^/.]+$/, "") // remove extension
    .replace(/\s\(\d+\)$/, "") // remove desktop (1), (2)
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function getPlannerName(filename: string): string {
  return filename
    .replace(/\.[^/.]+$/, "")
    .replace(/\s\(\d+\)$/, "")
    .trim();
}

function getDateKey(value: any): string {
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
 * 🔒 STRONG IDENTITY KEY
 * Starts with sourcePlannerId (not department).
 */
function buildImportKey(shift: any, sourcePlannerId: string): string {
  const parts = [
    sourcePlannerId, 
    shift.operativeUid || shift.userId,
    shift.dateKey || getDateKey(shift.date),
    normalize(shift.type || 'all-day'),
    normalize(shift.eNumber),
    normalize(shift.address),
    normalize(shift.contract),
    normalize(shift.task),
    normalize(shift.descriptionOfWorks),
    normalize(shift.sourceSheet),
    normalize(shift.sourceCell)
  ];
  return parts.join('|');
}

/**
 * 🔒 LEGACY FALLBACK MATCHING
 */
function isLegacyMatch(incoming: StandardShift, existing: Shift): boolean {
  const existingDateKey = existing.dateKey || getDateKey(existing.date);
  const incomingDateKey = getDateKey(incoming.date);

  return (
    (existing.userId === incoming.operativeUid) &&
    existingDateKey === incomingDateKey &&
    normalize(existing.address) === normalize(incoming.address) &&
    normalize(existing.task) === normalize(incoming.task) &&
    normalize(existing.type) === normalize(incoming.type)
  );
}

function hasChanges(existing: any, incoming: any): boolean {
  if (!existing.sourcePlannerId || !existing.importKey || !existing.dateKey) return true;
  
  return (
    normalize(existing.manager) !== normalize(incoming.manager) ||
    normalize(existing.contract) !== normalize(incoming.contract) ||
    normalize(existing.eNumber) !== normalize(incoming.eNumber) ||
    normalize(existing.task) !== normalize(incoming.task) ||
    normalize(existing.descriptionOfWorks) !== normalize(incoming.descriptionOfWorks)
  );
}

export function FileUploader({
  title,
  department,
  onImportComplete,
  onFileSelect,
}: {
  title: string;
  department: string;
  onImportComplete: (result: any) => void;
  onFileSelect: () => void;
}) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = async (file: File) => {
    setIsProcessing(true);
    setError(null);
    onFileSelect();

    const plannerId = getPlannerId(file.name);
    const plannerName = getPlannerName(file.name);

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const buffer = e.target?.result;
        if (!(buffer instanceof ArrayBuffer)) throw new Error('Could not read file.');

        const usersSnap = await getDocs(collection(db, 'users'));
        const userMap: UserMapEntry[] = usersSnap.docs.map(doc => {
          const u = doc.data() as any;
          return {
            uid: doc.id,
            originalName: u.name,
            normalizedName: (u.name || "").toLowerCase().replace(/[^a-z0-9]/g, ''),
            department: u.department,
          };
        });

        const parseResult = await parseWorkbook(Buffer.from(buffer), userMap);
        
        const incomingShifts = parseResult.shifts.map(s => {
          const dateKey = getDateKey(s.date);
          const tempShift = { ...s, dateKey };
          const importKey = buildImportKey(tempShift, plannerId);
          
          return { 
            ...s, 
            department, 
            sourcePlannerId: plannerId,
            sourcePlannerName: plannerName,
            plannerName: plannerName,
            profileId: plannerId,
            dateKey,
            importKey
          };
        });

        // 🔒 Query existing shifts for THIS planner
        const existingSnap = await getDocs(
          query(collection(db, 'shifts'), where('sourcePlannerId', '==', plannerId))
        );
        const existingShifts = existingSnap.docs.map(d => ({ id: d.id, ...d.data() } as Shift));

        // Legacy candidates (no planner ID yet)
        const legacySnap = await getDocs(
          query(collection(db, 'shifts'), 
            where('department', '==', department), 
            where('source', '==', 'import')
          )
        );
        const legacyCandidates = legacySnap.docs
          .map(d => ({ id: d.id, ...d.data() } as Shift))
          .filter(s => !s.sourcePlannerId);

        const toCreate: any[] = [];
        const toUpdate: any[] = [];
        const toSynced: any[] = [];
        const matchedDocIds = new Set<string>();

        incomingShifts.forEach(incoming => {
          if (parseResult.errors.some(err => err.row === incoming.sourceCell && err.severity === 'error')) return;

          let match = existingShifts.find(s => s.importKey === incoming.importKey);
          
          if (!match) {
            match = legacyCandidates.find(s => !matchedDocIds.has(s.id) && isLegacyMatch(incoming, s));
          }

          if (!match) {
            toCreate.push(incoming);
          } else {
            matchedDocIds.add(match.id);
            if (hasChanges(match, incoming)) {
              toUpdate.push({ id: match.id, old: match, new: incoming });
            } else {
              toSynced.push(match);
            }
          }
        });

        const toDelete = existingShifts.filter(s => !matchedDocIds.has(s.id));

        onImportComplete({
          toCreate,
          toUpdate,
          toDelete,
          toSynced,
          toIssues: parseResult.errors.filter(err => err.severity === 'error'),
          profileId: plannerId,
          profileName: plannerName,
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
              Upload your Excel file. Already published shifts will be matched and updated if necessary.
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