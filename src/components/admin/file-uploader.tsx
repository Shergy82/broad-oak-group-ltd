'use client';

import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, writeBatch, doc, getDocs, Timestamp } from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/shared/spinner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Upload } from 'lucide-react';
import type { Shift } from '@/types';

export function FileUploader() {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      const selectedFile = event.target.files[0];
       if (selectedFile) {
        setFile(selectedFile);
        setError(null);
       }
    }
  };

  const handleImport = async () => {
    if (!file || !db) {
      setError('Please select a file first.');
      return;
    }

    setIsUploading(true);
    setError(null);

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = e.target?.result;
        if (!data) throw new Error("Could not read file data.");
        
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1, blankrows: false, defval: '' });

        if (jsonData.length < 2) {
            throw new Error("The Excel file is too short. It must contain at least a date row and one task row.");
        }
        
        const usersCollection = collection(db, 'users');
        const usersSnapshot = await getDocs(usersCollection);
        const nameToUidMap = new Map<string, string>();
        usersSnapshot.forEach(doc => {
            const user = doc.data() as { name: string };
            if (user.name) {
              nameToUidMap.set(user.name.trim().toLowerCase(), doc.id);
            }
        });

        const parseDate = (dateValue: any): Date | null => {
            if (!dateValue) return null;
            if (typeof dateValue === 'number') {
                const excelEpoch = new Date(Date.UTC(1899, 11, 30));
                return new Date(excelEpoch.getTime() + dateValue * 24 * 60 * 60 * 1000);
            }
            if (typeof dateValue === 'string') {
                const parts = dateValue.split(/[/.-]/);
                if (parts.length === 3) {
                    const [d, m, y] = parts.map(p => parseInt(p, 10));
                    if (!isNaN(d) && !isNaN(m) && !isNaN(y)) {
                       const year = y < 100 ? 2000 + y : y;
                       return new Date(Date.UTC(year, m - 1, d));
                    }
                }
            }
            const parsed = new Date(dateValue);
            return isNaN(parsed.getTime()) ? null : parsed;
        };

        let dateRowIndex = -1;
        let dates: (Date | null)[] = [];
        for (let i = 0; i < jsonData.length; i++) {
            const row = jsonData[i] || [];
            if (row.length > 0 && row.some(cell => !!cell)) {
                const potentialDates = row.map(parseDate);
                if (potentialDates.filter(d => d !== null).length >= 3) {
                    dateRowIndex = i;
                    dates = potentialDates;
                    break;
                }
            }
        }

        if (dateRowIndex === -1) {
            throw new Error("Could not find a valid date row in the spreadsheet. Ensure there is a row where at least 3 columns contain valid dates in a recognizable format (e.g., DD/MM/YYYY).");
        }
        
        const batch = writeBatch(db);
        let shiftsAdded = 0;
        const unknownOperatives = new Set<string>();
        const parsingErrors: string[] = [];
        let currentProjectAddress = '';

        for (let r = dateRowIndex + 1; r < jsonData.length; r++) {
            const rowData = jsonData[r];
            if (!rowData || rowData.every(cell => !cell || cell.toString().trim() === '')) {
                continue; // Skip entirely empty rows
            }
            
            const addressCandidate = (rowData[0] || '').toString().trim();
            if (addressCandidate && !addressCandidate.includes(' - ')) {
                currentProjectAddress = addressCandidate;
            }

            if (!currentProjectAddress) {
                continue; // Skip rows until an address is found
            }

            for (let c = 0; c < rowData.length; c++) {
                const cellValue = (rowData[c] || '').toString().trim();
                const shiftDate = dates[c];

                if (!cellValue || !shiftDate || cellValue.toLowerCase().includes('holiday') || cellValue.toLowerCase().includes('on hold') || !cellValue.includes(' - ')) {
                    continue;
                }
                
                const parts = cellValue.split('-');
                if (parts.length < 2) {
                    parsingErrors.push(`Row ${r + 1}, Col ${String.fromCharCode(65 + c)}: Could not parse task and operative from "${cellValue}". Expected format: "Task Description - Operative Name"`);
                    continue;
                }

                const operativeName = parts.pop()!.trim();
                const task = parts.join('-').trim();

                const userId = nameToUidMap.get(operativeName.toLowerCase());

                if (!userId) {
                    unknownOperatives.add(operativeName);
                    continue;
                }
                
                const shiftDocRef = doc(collection(db, 'shifts'));
                const newShift: Omit<Shift, 'id'> = {
                    userId,
                    date: Timestamp.fromDate(shiftDate),
                    type: 'all-day',
                    status: 'pending-confirmation',
                    address: currentProjectAddress,
                    task,
                };

                batch.set(shiftDocRef, newShift);
                shiftsAdded++;
            }
        }
        
        if (unknownOperatives.size > 0) {
            throw new Error(`The following operatives were not found in the database: ${Array.from(unknownOperatives).join(', ')}. Please check spelling or add them as users.`);
        }

        if (shiftsAdded === 0) {
            let errorMessage = "No valid shifts were found to import. Please check the file's content and formatting.";
            if (parsingErrors.length > 0) {
                errorMessage = `Import failed with parsing errors:\n- ${parsingErrors.join('\n- ')}`;
            }
            throw new Error(errorMessage);
        }

        await batch.commit();

        toast({
          title: 'Import Successful',
          description: `${shiftsAdded} shifts have been added.`,
        });
        
        setFile(null);
        const fileInput = document.getElementById('shift-file-input') as HTMLInputElement;
        if (fileInput) {
            fileInput.value = "";
        }

      } catch (err: any) {
        console.error('Import failed:', err);
        setError(err.message || 'An unexpected error occurred during import.');
      } finally {
        setIsUploading(false);
      }
    };

    reader.onerror = () => {
        setError('Failed to read the file.');
        setIsUploading(false);
    }

    reader.readAsArrayBuffer(file);
  };

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Import Error</AlertTitle>
          <AlertDescription style={{ whiteSpace: 'pre-wrap' }}>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-col sm:flex-row gap-4">
        <Input
          id="shift-file-input"
          type="file"
          accept=".xlsx, .xls"
          onChange={handleFileChange}
          className="flex-grow file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer"
        />
        <Button onClick={handleImport} disabled={!file || isUploading} className="w-full sm:w-40">
          {isUploading ? <Spinner /> : <><Upload className="mr-2 h-4 w-4" /> Import Shifts</>}
        </Button>
      </div>
    </div>
  );
}
