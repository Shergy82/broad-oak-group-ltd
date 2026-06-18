'use client';

import { useState, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/shared/spinner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { UploadCloud, FileWarning, HelpCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { parseWorkbook, type UnifiedParseResult } from '@/lib/exceljs-parser';
import { type UserMapEntry } from '@/lib/importer/types';
import type { UserProfile } from '@/types';
import { Label } from '../ui/label';

interface FileUploaderProps {
  onImportComplete: (result: UnifiedParseResult) => void;
  userProfile: UserProfile;
}

export function FileUploader({ onImportComplete, userProfile }: FileUploaderProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const { toast } = useToast();

  const processFile = async (file: File) => {
    setIsProcessing(true);
    setError(null);

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const buffer = e.target?.result;
        if (!(buffer instanceof ArrayBuffer)) throw new Error('Could not read file.');

        // 1. Load User Database for matching
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

        // 2. Call the Refactored Modular Parser
        const result = await parseWorkbook(Buffer.from(buffer), userMap);
        
        onImportComplete(result);
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
            <p className="text-sm font-medium animate-pulse">Analyzing Spreadsheet Structure...</p>
          </div>
        ) : (
          <>
            <div className="bg-primary/10 p-4 rounded-full mb-4">
              <UploadCloud className="h-8 w-8 text-primary" />
            </div>
            <h3 className="text-lg font-semibold">Drop your planner here</h3>
            <p className="text-sm text-muted-foreground mb-4 text-center max-w-[300px]">We support Broad Oak Gas, Connexus, and standard tabular planners.</p>
            <Input id="shift-file-input" type="file" accept=".xlsx,.xls,.xlsm" className="sr-only" onChange={(e) => e.target.files?.[0] && processFile(e.target.files[0])} />
            <Button asChild variant="outline"><Label htmlFor="shift-file-input" className="cursor-pointer">Select File</Label></Button>
          </>
        )}
      </div>
    </div>
  );
}
