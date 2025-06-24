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
        
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1, blankrows: false });

        if (jsonData.length < 6) {
            throw new Error("The Excel file structure is incorrect. It must have at least 6 rows for the required information.");
        }

        const getCellValue = (row: number, col: number): string => {
            if (jsonData[row] && jsonData[row][col] != null) {
                return String(jsonData[row][col]).trim();
            }
            return '';
        };

        const mondayDateValue = jsonData[0]?.[1]; // Cell B1
        const operativeName = getCellValue(2, 1); // Cell B3
        const address = getCellValue(3, 1); // Cell B4
        const bNumber = getCellValue(4, 1); // Cell B5
        const siteManager = getCellValue(5, 1); // Cell B6

        if (!mondayDateValue) throw new Error("Monday's date is missing from cell B1.");
        const mondayDate = new Date(mondayDateValue);
        if (isNaN(mondayDate.getTime())) throw new Error(`Invalid date format in cell B1. Please use a standard format like YYYY-MM-DD.`);
        
        if (!operativeName) throw new Error("Operative name is missing from cell B3.");
        if (!address) throw new Error("Address is missing from cell B4.");

        const usersCollection = collection(db, 'users');
        const usersSnapshot = await getDocs(usersCollection);
        const nameToUidMap = new Map<string, string>();
        usersSnapshot.forEach(doc => {
            const user = doc.data() as { name: string };
            if (user.name) {
              nameToUidMap.set(user.name.trim().toLowerCase(), doc.id);
            }
        });
        
        const userId = nameToUidMap.get(operativeName.toLowerCase());
        if (!userId) {
          throw new Error(`Operative '${operativeName}' not found in the database. Please check the name or add them as a user.`);
        }

        const batch = writeBatch(db);
        let shiftsAdded = 0;
        
        for (let i = 0; i < 5; i++) {
          const colIndex = i + 1;
          const dailyTask = getCellValue(1, colIndex);

          if (dailyTask) {
            const shiftDate = new Date(mondayDate);
            shiftDate.setDate(shiftDate.getDate() + i);

            const shiftDocRef = doc(collection(db, 'shifts'));
            const newShift: Omit<Shift, 'id'> = {
              userId,
              date: Timestamp.fromDate(shiftDate),
              type: 'all-day',
              status: 'pending-confirmation',
              address,
              bNumber,
              dailyTask,
              ...(siteManager && { siteManager }),
            };

            batch.set(shiftDocRef, newShift);
            shiftsAdded++;
          }
        }
        
        if (shiftsAdded === 0) {
            throw new Error("No daily tasks found in cells B2 through F2. At least one task is required to import shifts.");
        }

        await batch.commit();

        toast({
          title: 'Import Successful',
          description: `${shiftsAdded} shifts for '${operativeName}' have been added for the week of ${mondayDate.toLocaleDateString()}.`,
        });
        
        setFile(null);
        const fileInput = document.getElementById('shift-file-input') as HTMLInputElement;
        if (fileInput) {
            fileInput.value = "";
        }

      } catch (err: any) {
        console.error('Import failed:', err);
        let errorMessage = err.message || 'An unexpected error occurred during import.';
        if (errorMessage.includes('permission-denied')) {
          errorMessage = "Permission denied. Please ensure your Firestore security rules allow admins to create shifts."
        }
        setError(errorMessage);
      } finally {
        setIsUploading(false);
      }
    };

    reader.onerror = (err) => {
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
          <AlertDescription>{error}</AlertDescription>
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
