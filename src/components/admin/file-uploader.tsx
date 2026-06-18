'use client';

import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where, Timestamp } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/shared/spinner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { UploadCloud, FileWarning, HelpCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { parseWorkbook, type UnifiedParseResult } from '@/lib/exceljs-parser';
import { type UserMapEntry, type StandardShift } from '@/lib/importer/types';
import type { UserProfile, Shift } from '@/types';
import { Label } from '../ui/label';
import { startOfToday } from 'date-fns';

interface FileUploaderProps {
  onImportComplete: (result: UnifiedParseResult & { toCreate: StandardShift[], toUpdate: any[], toDelete: any[] }) => void;
  onFileSelect: () => void;
  userProfile: UserProfile;
}

export function FileUploader({ onImportComplete, onFileSelect, userProfile }: FileUploaderProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const { toast } = useToast();

  const normalizePlannerName = (filename: string) => {
    return filename
      .toLowerCase()
      .replace(/\.[^/.]+$/, "") // remove extension
      .replace(/\s*\(\d+\)\s*$/, "") // remove download numbers like (43)
      .trim();
  };

  const processFile = async (file: File) => {
    setIsProcessing(true);
    setError(null);
    onFileSelect();

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const buffer = e.target?.result;
        if (!(buffer instanceof ArrayBuffer)) throw new Error('Could not read file.');

        // 1. Setup User Map and Scoping
        const usersSnap = await getDocs(collection(db, 'users'));
        const userMap: UserMapEntry[] = usersSnap.docs.map(doc => {
          const u = doc.data() as UserProfile;
          return {
            uid: doc.id,
            originalName: u.name,
            normalizedName: u.name.toLowerCase().replace(/[^a-z]/g, ''),
            department: u.department
          };
        });

        // 2. Parse the Workbook
        const parseResult = await parseWorkbook(Buffer.from(buffer), userMap);
        
        // 3. Run "Dry Run" Logic (Compare with Database)
        const plannerScope = normalizePlannerName(file.name);
        const today = startOfToday();
        
        // Only fetch existing shifts for this planner that are Today or Future
        const existingShiftsQuery = query(
          collection(db, 'shifts'),
          where('department', '==', userProfile.department),
          where('date', '>=', Timestamp.fromDate(today))
        );
        
        const existingSnap = await getDocs(existingShiftsQuery);
        const existingShifts = existingSnap.docs
          .map(d => ({ id: d.id, ...d.data() } as Shift))
          // Client-side filter for planner scope
          .filter(s => s.plannerName && normalizePlannerName(s.plannerName) === plannerScope);

        const toCreate: StandardShift[] = [];
        const toUpdate: any[] = [];
        const toDelete: Shift[] = [];

        const incomingKeys = new Map<string, StandardShift>();
        
        // Shift Fingerprint: [Date] + [User] + [Address]
        // This makes Task Description updates safe
        const getShiftKey = (s: StandardShift | Shift) => {
          const d = 'date' in s && s.date instanceof Date ? s.date : (s as Shift).date.toDate();
          const dateStr = d.toISOString().split('T')[0];
          const uid = 'operativeUid' in s ? s.operativeUid : (s as Shift).userId;
          const addr = (s as any).address?.toLowerCase().trim() || 'unknown';
          return `${dateStr}-${uid}-${addr}`;
        };

        // Compare Incoming
        parseResult.shifts.forEach(incoming => {
          const key = getShiftKey(incoming);
          incomingKeys.set(key, incoming);

          const match = existingShifts.find(ex => getShiftKey(ex) === key);
          if (match) {
            // Check if actual details changed
            const hasChanged = match.task !== incoming.task || match.type !== incoming.type;
            if (hasChanged) {
              toUpdate.push({ id: match.id, old: match, new: incoming });
            }
          } else {
            toCreate.push(incoming);
          }
        });

        // Identify Deletions (Strictly Future/Today in Scope)
        existingShifts.forEach(existing => {
          const key = getShiftKey(existing);
          if (!incomingKeys.has(key)) {
            toDelete.push(existing);
          }
        });

        onImportComplete({
          ...parseResult,
          toCreate,
          toUpdate,
          toDelete,
          profileId: plannerScope // Use filename as the scope ID
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
          <AlertTitle className="flex items-center gap-2">Processing Error <HelpCircle className="h-4 w-4" /></AlertTitle>
          <AlertDescription className="text-xs whitespace-pre-wrap">{error}</AlertDescription>
        </Alert>
      )}

      <div 
        onDrop={(e) => { e.preventDefault(); setIsDragOver(false); if(e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]); }} 
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }} 
        onDragLeave={() => setIsDragOver(false)} 
        className={cn(
          'flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-xl h-64 transition-all',
          isDragOver ? 'border-primary bg-primary/5 scale-[0.99]' : 'border-muted-foreground/20 hover:border-primary/40'
        )}
      >
        {isProcessing ? (
          <div className="flex flex-col items-center gap-3">
            <Spinner size="lg" />
            <p className="text-sm font-medium animate-pulse">Running Diagnostic Test...</p>
          </div>
        ) : (
          <>
            <div className="bg-primary/10 p-4 rounded-full mb-4">
              <UploadCloud className="h-8 w-8 text-primary" />
            </div>
            <h3 className="text-lg font-semibold">Drop planner here to Run Test</h3>
            <p className="text-sm text-muted-foreground mb-4 text-center max-w-[300px]">We will verify all names, dates, and addresses before making any changes.</p>
            <Input id="shift-file-input" type="file" accept=".xlsx,.xls,.xlsm" className="sr-only" onChange={(e) => e.target.files?.[0] && processFile(e.target.files[0])} />
            <Button asChild variant="outline"><Label htmlFor="shift-file-input" className="cursor-pointer">Select File</Label></Button>
          </>
        )}
      </div>
    </div>
  );
}
