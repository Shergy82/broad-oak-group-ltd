
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
      .replace(/\.[^/.]+$/, "") 
      .replace(/\s*\(\d+\)\s*$/, "")
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

        // 1. Setup User Map (Ensuring UID is mapped to Auth UID)
        const usersSnap = await getDocs(collection(db, 'users'));
        const userMap: UserMapEntry[] = usersSnap.docs.map(doc => {
          const u = doc.data() as UserProfile;
          return {
            uid: u.uid || doc.id, // Ensure we use the actual Auth UID
            originalName: u.name,
            normalizedName: u.name.toLowerCase().replace(/[^a-z]/g, ''),
            department: u.department
          };
        });

        // 2. Parse the Workbook
        const parseResult = await parseWorkbook(Buffer.from(buffer), userMap);
        
        // 3. Dry Run Logic (Clean Slate)
        const plannerScope = normalizePlannerName(file.name);
        
        onImportComplete({
          ...parseResult,
          toCreate: parseResult.shifts,
          toUpdate: [],
          toDelete: [],
          profileId: plannerScope
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
          <AlertTitle className="flex items-center gap-2">Processing Error</AlertTitle>
          <AlertDescription className="text-xs whitespace-pre-wrap">{error}</AlertDescription>
        </Alert>
      )}

      <div 
        onDrop={(e) => { e.preventDefault(); setIsDragOver(false); if(e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]); }} 
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
            <p className="text-sm font-medium animate-pulse">Scanning file structure...</p>
          </div>
        ) : (
          <>
            <div className="bg-primary/10 p-4 rounded-full mb-4">
              <UploadCloud className="h-8 w-8 text-primary" />
            </div>
            <h3 className="text-lg font-semibold">Drop planner here to begin</h3>
            <p className="text-sm text-muted-foreground mb-4 text-center max-w-[300px]">The engine is in reset mode. No shifts will be extracted yet.</p>
            <Input id="shift-file-input" type="file" accept=".xlsx,.xls,.xlsm" className="sr-only" onChange={(e) => e.target.files?.[0] && processFile(e.target.files[0])} />
            <Button asChild variant="outline"><Label htmlFor="shift-file-input" className="cursor-pointer">Select File</Label></Button>
          </>
        )}
      </div>
    </div>
  );
}
