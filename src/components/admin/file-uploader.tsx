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
import { 
  normaliseText, 
  getTodayDateKey, 
  formatDateKey, 
  isHistoricShift, 
  buildImportKey 
} from '@/lib/importer/core/utils';
import type { Shift } from '@/types';
import { Label } from '../ui/label';

/**
 * STABLE SOURCE ID
 * Normalizes planner filename to a stable identifier.
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
 * BUSINESS COMPARISON ENGINE
 * Identifies meaningful changes for the Updates tab.
 */
const COMPARABLE_FIELDS = [
  "operativeUid",
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

function getBusinessChanges(existing: any, incoming: any) {
  const changes: { field: string; old: string; new: string }[] = [];
  
  if (isHistoricShift(existing)) return [];

  COMPARABLE_FIELDS.forEach(field => {
    const newVal = normaliseText(incoming[field]);
    let currentVal = normaliseText(existing[field]);

    // Handle equivalent logical fields for legacy data
    if (field === 'operativeUid' && !existing.operativeUid) currentVal = normaliseText(existing.userId);
    if (field === 'operative' && !existing.operative) currentVal = normaliseText(existing.userName);
    if (field === 'dateKey' && !existing.dateKey) currentVal = formatDateKey(existing.date);

    if (currentVal !== newVal) {
      changes.push({ 
        field, 
        old: String(existing[field] || ""), 
        new: String(incoming[field] || "") 
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

        // 1. Load users for matching
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

        // 2. Parse using isolated profile logic
        const parseResult = await parseWorkbook(Buffer.from(buffer), userMap, department);
        
        // 3. Fetch existing ACTIVE shifts from this source
        const existingSnap = await getDocs(
          query(collection(db, 'shifts'), where('sourcePlannerId', '==', planner.id))
        );
        const allExistingShifts = existingSnap.docs.map(d => ({ id: d.id, ...d.data() } as Shift));
        const existingActiveShifts = allExistingShifts.filter(s => !isHistoricShift(s));

        // 4. Reconcile
        const toCreate: any[] = [];
        const toUpdate: any[] = [];
        const toSynced: any[] = [];
        const matchedDocIds = new Set<string>();

        parseResult.shifts.forEach(incomingRaw => {
          const dateKey = formatDateKey(incomingRaw.date);
          if (dateKey < todayKey) return; // Silent skip past

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

          // Primary Match
          const match = existingActiveShifts.find(s => s.importKey === incoming.importKey);
          
          if (match) {
            matchedDocIds.add(match.id);
            const changes = getBusinessChanges(match, incoming);
            if (changes.length > 0) {
              toUpdate.push({ id: match.id, old: match, new: incoming, changes });
            } else {
              toSynced.push(match);
            }
          } else {
            // Alias Fallback
            const legacyMatch = existingActiveShifts.find(s => 
                !matchedDocIds.has(s.id) &&
                normaliseText(s.userId || s.operativeUid) === normaliseText(incoming.operativeUid) &&
                (s.dateKey || formatDateKey(s.date)) === incoming.dateKey &&
                normaliseText(s.sourceCell) === normaliseText(incoming.sourceCell)
            );

            if (legacyMatch) {
              matchedDocIds.add(legacyMatch.id);
              const changes = getBusinessChanges(legacyMatch, incoming);
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

        // Deletions (Only for active future shifts from this source)
        const toDelete = existingActiveShifts.filter(s => !matchedDocIds.has(s.id));

        onImportComplete({
          toCreate,
          toUpdate,
          toDelete,
          toSynced,
          toIssues: parseResult.errors,
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
            <p className="text-sm font-medium animate-pulse text-muted-foreground">Reconciling {title}...</p>
          </div>
        ) : (
          <>
            <div className="bg-primary/10 p-4 rounded-full mb-4">
              <UploadCloud className="h-8 w-8 text-primary" />
            </div>
            <h3 className="text-lg font-semibold">Upload {title}</h3>
            <p className="text-sm text-muted-foreground mb-4 text-center px-4">
              Excel file. Historic dates are ignored. Future shifts reconciled.
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
