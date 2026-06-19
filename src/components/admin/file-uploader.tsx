'use client';

import { useState, useRef } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
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
 */
function normalizeText(val: any): string {
  if (val === undefined || val === null) return "";
  return String(val)
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Normalizes planner filename to a stable source ID.
 * Strips desktop suffixes like (1), (2) and extensions.
 */
function getPlannerInfo(filename: string) {
  const base = filename
    .replace(/\.[^/.]+$/, "") // remove extension
    .replace(/\s*\(\d+\)$/, "") // remove desktop suffixes
    .replace(/\s+copy\b/gi, "")
    .trim();
  
  const id = base.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  const name = base.toUpperCase();

  return { id, name };
}

/**
 * Generates YYYY-MM-DD from any date source.
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

function getTodayDateKey(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 🔒 STABLE IDENTITY KEY
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
    shift.sourceSheet || "",
    shift.sourceCell || ""
  ];
  return parts.map(p => normalizeText(p)).join('|');
}

/**
 * 🔒 SMART BUSINESS COMPARISON
 */
const BUSINESS_FIELDS = [
  "operativeUid",
  "userId",
  "userName",
  "operative",
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
    // Standardize comparison using normalized versions of fields
    const newVal = normalizeText(incoming[field]);
    let currentVal = normalizeText(existing[field]);

    // Handle legacy date comparison
    if (field === 'dateKey' && !currentVal && existing.date) {
      currentVal = getDateKey(existing.date);
    }
    
    // Alias handling: operativeUid vs userId
    if (field === 'operativeUid' && !existing.operativeUid && existing.userId) {
        currentVal = normalizeText(existing.userId);
    }
    if (field === 'operative' && !existing.operative && existing.userName) {
        currentVal = normalizeText(existing.userName);
    }

    if (currentVal !== newVal) {
      changes.push({ 
        field, 
        old: String(existing[field] || "(blank)"), 
        new: String(incoming[field] || "(blank)") 
      });
    }
  });

  return changes;
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
    const todayKey = getTodayDateKey();

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
        
        const toCreate: any[] = [];
        const toUpdate: any[] = [];
        const toSynced: any[] = [];
        const toIssues: any[] = [];
        const matchedDocIds = new Set<string>();

        // 1. Process Issues (Today/Future only)
        parseResult.errors.forEach(err => {
            if (err.dateKey && err.dateKey >= todayKey) {
                toIssues.push(err);
            }
        });

        // 2. Fetch existing shifts for this source
        const existingSnap = await getDocs(
          query(collection(db, 'shifts'), where('sourcePlannerId', '==', planner.id))
        );
        const existingShifts = existingSnap.docs.map(d => ({ id: d.id, ...d.data() } as Shift));

        // 3. Process parsed shifts
        parseResult.shifts.forEach(incomingRaw => {
          const dateKey = getDateKey(incomingRaw.date);
          
          // 🔒 SILENT PAST DATE SKIP
          if (dateKey < todayKey) return;

          const incoming = { 
            ...incomingRaw, 
            department, 
            sourcePlannerId: planner.id,
            sourcePlannerName: planner.name,
            plannerName: planner.name,
            profileId: planner.id,
            dateKey,
            importKey: buildImportKey({ ...incomingRaw, dateKey }, planner.id)
          };

          // Categorize by identity key
          const match = existingShifts.find(s => s.importKey === incoming.importKey);
          
          if (match) {
            matchedDocIds.add(match.id);
            const changes = getChangedBusinessFields(match, incoming);
            if (changes.length > 0) {
              toUpdate.push({ id: match.id, old: match, new: incoming, changes });
            } else {
              toSynced.push(match);
            }
          } else {
            // Check for legacy match by business fingerprint
            const legacyMatch = existingShifts.find(s => 
                !matchedDocIds.has(s.id) &&
                normalizeText(s.userId || s.operativeUid) === normalizeText(incoming.operativeUid) &&
                getDateKey(s.date) === incoming.dateKey &&
                normalizeText(s.address) === normalizeText(incoming.address) &&
                normalizeText(s.sourceCell) === normalizeText(incoming.sourceCell)
            );

            if (legacyMatch) {
              matchedDocIds.add(legacyMatch.id);
              const changes = getChangedBusinessFields(legacyMatch, incoming);
              if (changes.length > 0) {
                toUpdate.push({ id: legacyMatch.id, old: legacyMatch, new: incoming, changes });
              } else {
                toSynced.push(legacyMatch);
              }
            } else {
              toCreate.push(incoming);
            }
          }
        });

        // 4. Deletions (Only shifts that actually match this planner source and are missing now)
        const toDelete = existingShifts.filter(s => {
            const sDateKey = getDateKey(s.date);
            // Skip deletion for past shifts (silently ignore them)
            if (sDateKey < todayKey) return false;
            return !matchedDocIds.has(s.id);
        });

        onImportComplete({
          toCreate,
          toUpdate,
          toDelete,
          toSynced,
          toIssues,
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
