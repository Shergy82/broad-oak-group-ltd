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
import { type UserMapEntry } from '@/lib/importer/types';
import type { Shift } from '@/types';
import { Label } from '../ui/label';

/**
 * 🔒 ROBUST NORMALIZATION ENGINE
 * Collapses whitespace, trims, and lowercases for safe comparison.
 */
function normalizeText(val: any): string {
  if (val === undefined || val === null) return "";
  return String(val)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalizes planner filename to a stable source ID.
 * Strips desktop suffixes like (1), (12) and extensions.
 */
function getPlannerInfo(filename: string) {
  const base = filename
    .replace(/\.[^/.]+$/, "") // remove extension
    .replace(/\s\(\d+\)$/, "") // remove desktop suffixes like (1)
    .replace(/\s+copy\b/gi, "")
    .trim();
  
  const id = base.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  const name = base.toUpperCase();

  return { id, name };
}

/**
 * Generates YYYY-MM-DD from any date source for timezone-safe comparisons.
 */
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
 * 🔒 BUSINESS VS METADATA COMPARISON
 * These fields trigger a visible 'Update' in the UI.
 * Must match the write payload in the Cloud Function.
 */
const BUSINESS_FIELDS = [
  "userId", 
  "dateKey", 
  "type", 
  "startTime", 
  "endTime", 
  "address", 
  "contract", 
  "eNumber", 
  "task", 
  "descriptionOfWorks", 
  "manager", 
  "room"
];

function getChangedBusinessFields(existing: any, incoming: any) {
  const changes: { field: string; old: string; new: string }[] = [];
  
  BUSINESS_FIELDS.forEach(field => {
    // Map incoming fields if they use different names (e.g. operativeUid vs userId)
    const incomingVal = (field === 'userId') ? (incoming.userId || incoming.operativeUid) : incoming[field];
    
    // For legacy shifts, calculate dateKey from timestamp if missing
    const existingVal = (field === 'dateKey' && !existing.dateKey) ? getDateKey(existing.date) : existing[field];

    const v1 = normalizeText(existingVal);
    const v2 = normalizeText(incomingVal);

    if (v1 !== v2) {
      changes.push({ 
        field, 
        old: existingVal || "(blank)", 
        new: (field === 'userId' ? incoming.operative : incomingVal) || "(blank)" 
      });
    }
  });

  return changes;
}

/**
 * 🔒 STRONG IDENTITY KEY
 * uniquely identifies a specific job row.
 */
function buildImportKey(shift: any, sourcePlannerId: string): string {
  const parts = [
    sourcePlannerId, 
    shift.operativeUid || shift.userId,
    shift.dateKey || getDateKey(shift.date),
    shift.type || 'all-day',
    shift.startTime || "",
    shift.endTime || "",
    shift.eNumber || "",
    shift.address || "",
    shift.contract || "",
    shift.task || "",
    shift.descriptionOfWorks || "",
    shift.room || "",
    shift.sourceSheet || "",
    shift.sourceCell || ""
  ];
  return parts.map(p => normalizeText(p)).join('|');
}

/**
 * 🔒 LEGACY FALLBACK MATCHING
 */
function isLegacyMatch(incoming: any, existing: any): boolean {
  const existingDateKey = existing.dateKey || getDateKey(existing.date);
  const incomingDateKey = incoming.dateKey || getDateKey(incoming.date);

  return (
    (existing.userId === (incoming.userId || incoming.operativeUid)) &&
    existingDateKey === incomingDateKey &&
    normalizeText(existing.address) === normalizeText(incoming.address) &&
    normalizeText(existing.task) === normalizeText(incoming.task) &&
    normalizeText(existing.type) === normalizeText(incoming.type)
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

    const planner = getPlannerInfo(file.name);

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
            normalizedName: (u.name || "").toLowerCase().replace(/[^a-z0-9]/g, ''),
            originalName: u.name,
            department: u.department,
          };
        });

        const parseResult = await parseWorkbook(Buffer.from(buffer), userMap);
        
        const incomingShifts = parseResult.shifts.map(s => {
          const dateKey = getDateKey(s.date);
          const tempShift = { ...s, dateKey };
          const importKey = buildImportKey(tempShift, planner.id);
          
          return { 
            ...s, 
            department, 
            sourcePlannerId: planner.id,
            sourcePlannerName: planner.name,
            plannerName: planner.name,
            profileId: planner.id,
            dateKey,
            importKey
          };
        });

        // 🔒 SCOPED FETCH: Only check existing shifts from the SAME planner source
        const existingSnap = await getDocs(
          query(collection(db, 'shifts'), where('sourcePlannerId', '==', planner.id))
        );
        const existingShifts = existingSnap.docs.map(d => ({ id: d.id, ...d.data() } as Shift));

        // 🔒 LEGACY FETCH: For shifts that don't have sourcePlannerId yet
        const legacySnap = await getDocs(
          query(collection(db, 'shifts'), 
            where('department', '==', department), 
            where('source', '==', 'import')
          )
        );
        const legacyCandidates = legacySnap.docs
          .map(d => ({ id: d.id, ...d.data() } as Shift))
          .filter(s => !s.sourcePlannerId || !s.importKey);

        const toCreate: any[] = [];
        const toUpdate: any[] = [];
        const toSynced: any[] = [];
        const matchedDocIds = new Set<string>();

        incomingShifts.forEach(incoming => {
          if (parseResult.errors.some(err => err.row === incoming.sourceCell && err.severity === 'error')) return;

          // 1. Try Direct Key Match
          let match = existingShifts.find(s => s.importKey === incoming.importKey);
          
          // 2. Try Legacy Fallback
          if (!match) {
            match = legacyCandidates.find(s => !matchedDocIds.has(s.id) && isLegacyMatch(incoming, s));
          }

          if (!match) {
            toCreate.push(incoming);
          } else {
            matchedDocIds.add(match.id);
            const changes = getChangedBusinessFields(match, incoming);
            
            // We silently backfill metadata even if it's "Synced"
            const needsBackfill = !match.sourcePlannerId || !match.importKey || !match.dateKey;

            if (changes.length > 0) {
              toUpdate.push({ id: match.id, old: match, new: incoming, changes });
            } else {
              // Categorized as Synced, but backfilled silently during publish
              toSynced.push({ ...match, _isBackfill: needsBackfill, _newMetadata: incoming });
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
          profileId: planner.id,
          profileName: planner.name,
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
              Upload your Excel file. Already published shifts will be matched and classified.
            </p>
            <input
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
