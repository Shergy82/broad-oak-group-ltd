'use client';

import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, writeBatch, doc, query, where, getDocs, Timestamp } from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/shared/spinner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Upload } from 'lucide-react';
import type { Shift, UserProfile } from '@/types';

// Define the expected structure of a row in the Excel file
interface ShiftImportRow {
  Date: string | number; // Excel dates can be numbers or strings
  'User Email': string;
  'Shift Type': 'am' | 'pm' | 'all-day';
}

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
        const jsonData = XLSX.utils.sheet_to_json<ShiftImportRow>(worksheet);

        if (jsonData.length === 0) {
            throw new Error("The selected Excel file is empty or in the wrong format.");
        }

        // Fetch all users to match emails with uids
        const usersCollection = collection(db, 'users');
        const usersSnapshot = await getDocs(usersCollection);
        const emailToUidMap = new Map<string, string>();
        usersSnapshot.forEach(doc => {
            const user = doc.data() as { email: string };
            if (user.email) {
              emailToUidMap.set(user.email.toLowerCase(), doc.id);
            }
        });

        const batch = writeBatch(db);
        let shiftsAdded = 0;
        const notFoundEmails = new Set<string>();

        jsonData.forEach((row, index) => {
          const email = row['User Email']?.toLowerCase();
          const shiftType = row['Shift Type'];
          const date = row.Date;

          if (!email || !shiftType || !date) {
            console.warn(`Skipping row ${index + 2} due to missing data.`);
            return;
          }
          
          const userId = emailToUidMap.get(email);

          if (!userId) {
            notFoundEmails.add(row['User Email']);
            return;
          }

          const shiftDocRef = doc(collection(db, 'shifts'));
          
          const newShift: Omit<Shift, 'id'> = {
            userId,
            date: Timestamp.fromDate(new Date(date)),
            type: shiftType,
            status: 'pending-confirmation',
          };

          batch.set(shiftDocRef, newShift);
          shiftsAdded++;
        });
        
        if (notFoundEmails.size > 0) {
            throw new Error(`The following user emails were not found in the database: ${Array.from(notFoundEmails).join(', ')}. Please add them as users before importing their shifts.`);
        }

        if (shiftsAdded === 0) {
            throw new Error("No valid shifts were found to import. Please check the file content and format.");
        }

        await batch.commit();

        toast({
          title: 'Import Successful',
          description: `${shiftsAdded} shifts have been added to the schedule.`,
        });
        
        // Reset the file input visually by clearing the state
        setFile(null);
        // And reset the actual input element
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
          accept=".xlsx, .xls, .csv"
          onChange={handleFileChange}
          className="flex-grow file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer"
        />
        <Button onClick={handleImport} disabled={!file || isUploading} className="w-full sm:w-40">
          {isUploading ? <Spinner /> : <><Upload className="mr-2 h-4 w-4" /> Import Shifts</>}
        Button>
      </div>
    </div>
  );
}
