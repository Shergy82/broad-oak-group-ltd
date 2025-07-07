
'use client';

import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, writeBatch, doc, getDocs, query, where, Timestamp } from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/shared/spinner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Upload } from 'lucide-react';
import type { Shift, UserProfile } from '@/types';

type ParsedShift = Omit<Shift, 'id' | 'status' | 'date'> & { date: Date };

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

  const getShiftKey = (shift: { userId: string, date: Date | Timestamp, type: 'am' | 'pm' | 'all-day' }): string => {
    const d = (shift.date as any).toDate ? (shift.date as Timestamp).toDate() : (shift.date as Date);
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${shift.userId}-${year}-${month}-${day}-${shift.type}`;
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
        
        const usersSnapshot = await getDocs(collection(db, 'users'));
        const nameToUidMap = new Map<string, string>();
        const userNames: string[] = [];
        usersSnapshot.forEach(doc => {
            const user = doc.data() as UserProfile;
            if (user.name) {
              const trimmedName = user.name.trim();
              nameToUidMap.set(trimmedName.toLowerCase(), doc.id);
              userNames.push(trimmedName);
            }
        });
        userNames.sort((a, b) => b.length - a.length);

        const parseDate = (dateValue: any): Date | null => {
            if (!dateValue) return null;
            if (dateValue instanceof Date) {
                if (isNaN(dateValue.getTime())) return null;
                return new Date(Date.UTC(dateValue.getFullYear(), dateValue.getMonth(), dateValue.getDate()));
            }
            if (typeof dateValue === 'number' && dateValue > 1) {
                const jsDate = new Date(Math.round((dateValue - 25569) * 864e5));
                return new Date(Date.UTC(jsDate.getUTCFullYear(), jsDate.getUTCMonth(), jsDate.getUTCDate()));
            }
            if (typeof dateValue === 'string') {
                const parts = dateValue.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
                if (parts) {
                    const day = parseInt(parts[1], 10);
                    const month = parseInt(parts[2], 10) - 1;
                    const year = parseInt(parts[3], 10);
                    if (year > 1900 && month >= 0 && month < 12 && day > 0 && day <= 31) {
                        const d = new Date(Date.UTC(year, month, day));
                        if (!isNaN(d.getTime())) {
                            return d;
                        }
                    }
                }
            }
            return null;
        };

        const isLikelyAddress = (str: string): boolean => {
            if (!str || str.length < 10) return false;
            const lowerCaseStr = str.toLowerCase();
            if (lowerCaseStr.includes('week commencing') || lowerCaseStr.includes('project address') || lowerCaseStr.includes('job address')) {
                return false;
            }
            if (!/\d/.test(str)) return false;
            if (str.split(' ').length < 2) return false;
            return true;
        };

        const projectsToCreate = new Map<string, { address: string; bNumber: string; council: string, manager: string }>();
        const existingProjectsSnapshot = await getDocs(collection(db, 'projects'));
        const existingAddresses = new Set<string>();
        existingProjectsSnapshot.forEach(doc => {
            const data = doc.data();
            if(data.address) existingAddresses.add(data.address.toLowerCase());
        });

        const shiftsFromExcel: ParsedShift[] = [];
        const unknownOperativesCount = new Map<string, number>();
        const allDatesFound: Date[] = [];

        for (const sheetName of workbook.SheetNames) {
            const worksheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1, blankrows: false, defval: '' });

            if (jsonData.length < 2) continue;

            let dateRowIndex = -1;
            let dates: (Date | null)[] = [];
            for (let i = 0; i < jsonData.length; i++) {
                const row = jsonData[i] || [];
                const potentialDates = row.map(parseDate);
                if (row.length > 2 && potentialDates.slice(2).filter(d => d !== null).length > 0) {
                     dateRowIndex = i;
                     dates = potentialDates;
                     break;
                }
            }
            if (dateRowIndex === -1) continue;

            dates.forEach(d => { if (d) allDatesFound.push(d); });
            
            let currentProjectAddress = '';
            let currentBNumber = '';
            for (let r = dateRowIndex + 1; r < jsonData.length; r++) {
                const rowData = jsonData[r];
                if (!rowData || rowData.every(cell => !cell || cell.toString().trim() === '')) continue;
                
                const addressCandidate = (rowData[0] || '').toString().trim();
                if (isLikelyAddress(addressCandidate)) {
                    currentProjectAddress = addressCandidate;
                    currentBNumber = (rowData[1] || '').toString().trim();
                    if (currentProjectAddress && !existingAddresses.has(currentProjectAddress.toLowerCase()) && !projectsToCreate.has(currentProjectAddress.toLowerCase())) {
                        projectsToCreate.set(currentProjectAddress.toLowerCase(), { address: currentProjectAddress, bNumber: currentBNumber, council: '', manager: '' });
                    }
                }

                if (!currentProjectAddress) continue;

                for (let c = 2; c < rowData.length; c++) {
                    const cellValue = (rowData[c] || '').toString().trim().replace(/[\u2012\u2013\u2014\u2015]/g, '-');
                    const shiftDate = dates[c];

                    if (!cellValue || !shiftDate || cellValue.toLowerCase().includes('holiday') || cellValue.toLowerCase().includes('on hold')) continue;
                    
                    let parsedShift: { task: string; userId: string; type: 'am' | 'pm' | 'all-day' } | null = null;
                    
                    for (const name of userNames) {
                        const escapedName = name.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                        const regex = new RegExp(`\\s*-\\s*${escapedName}$`, 'i');
                        const match = cellValue.match(regex);

                        if (match && match.index !== undefined) {
                            let task = cellValue.substring(0, match.index).trim();
                            const userId = nameToUidMap.get(name.toLowerCase());
                            
                            let type: 'am' | 'pm' | 'all-day' = 'all-day';
                            const amPmMatch = task.match(/\b(AM|PM)\b/i);
                            if (amPmMatch) {
                                type = amPmMatch[0].toLowerCase() as 'am' | 'pm';
                                task = task.replace(new RegExp(`\\s*\\b${amPmMatch[0]}\\b`, 'i'), '').trim();
                            }

                            if (task && userId) {
                                parsedShift = { task, userId, type };
                                break;
                            }
                        }
                    }

                    if (parsedShift) {
                         shiftsFromExcel.push({ ...parsedShift, date: shiftDate, address: currentProjectAddress, task: parsedShift.task, bNumber: currentBNumber });
                    } else if (cellValue.includes('-')) {
                        const unknownName = cellValue.substring(cellValue.lastIndexOf('-') + 1).trim();
                        if (unknownName) {
                            unknownOperativesCount.set(unknownName, (unknownOperativesCount.get(unknownName) || 0) + 1);
                        }
                    }
                }
            }
        }

        if (allDatesFound.length === 0) {
            throw new Error("No valid dates found. Ensure dates are present and correctly formatted (e.g., DD/MM/YYYY) in at least one tab.");
        }
        
        const minDate = new Date(Math.min(...allDatesFound.map(d => d.getTime())));
        const maxDate = new Date(Math.max(...allDatesFound.map(d => d.getTime())));

        // --- RECONCILIATION LOGIC ---
        const shiftsQuery = query(
            collection(db, 'shifts'),
            where('date', '>=', Timestamp.fromDate(minDate)),
            where('date', '<=', Timestamp.fromDate(maxDate))
        );
        const existingShiftsSnapshot = await getDocs(shiftsQuery);

        const existingShiftsMap = new Map<string, Shift>();
        existingShiftsSnapshot.forEach(doc => {
            const shiftData = { id: doc.id, ...doc.data() } as Shift;
            existingShiftsMap.set(getShiftKey(shiftData), shiftData);
        });

        const batch = writeBatch(db);
        let shiftsCreated = 0;
        let shiftsUpdated = 0;
        let shiftsDeleted = 0;

        const excelKeys = new Set<string>();

        for (const excelShift of shiftsFromExcel) {
            const key = getShiftKey(excelShift);
            excelKeys.add(key);
            const existingShift = existingShiftsMap.get(key);

            if (existingShift) {
                const taskChanged = (existingShift.task || "").trim() !== (excelShift.task || "").trim();
                const addressChanged = (existingShift.address || "").trim() !== (excelShift.address || "").trim();
                const bNumberChanged = (existingShift.bNumber || "").trim() !== (excelShift.bNumber || "").trim();
                
                if (taskChanged || addressChanged || bNumberChanged) {
                    const updateData = {
                        task: excelShift.task,
                        address: excelShift.address,
                        bNumber: excelShift.bNumber || '',
                    };
                    batch.update(doc(db, 'shifts', existingShift.id), updateData);
                    shiftsUpdated++;
                }
            } else {
                const newShiftData = {
                    ...excelShift,
                    date: Timestamp.fromDate(excelShift.date),
                    status: 'pending-confirmation',
                };
                batch.set(doc(collection(db, 'shifts')), newShiftData);
                shiftsCreated++;
            }
        }

        for (const [key, shift] of existingShiftsMap.entries()) {
            if (!excelKeys.has(key)) {
                batch.delete(doc(db, 'shifts', shift.id));
                shiftsDeleted++;
            }
        }
        
        let projectsAdded = 0;
        projectsToCreate.forEach(project => {
            projectsAdded++;
            const reviewDate = new Date();
            reviewDate.setDate(reviewDate.getDate() + 28);
            batch.set(doc(collection(db, 'projects')), { 
                ...project,
                createdAt: Timestamp.now(),
                nextReviewDate: Timestamp.fromDate(reviewDate)
            });
        });

        if (shiftsCreated > 0 || shiftsUpdated > 0 || shiftsDeleted > 0 || projectsAdded > 0) {
            await batch.commit();
        }
        
        let descriptionParts = [];
        if (shiftsCreated > 0) descriptionParts.push(`created ${shiftsCreated} new shift(s)`);
        if (shiftsUpdated > 0) descriptionParts.push(`updated ${shiftsUpdated} shift(s)`);
        if (shiftsDeleted > 0) descriptionParts.push(`deleted ${shiftsDeleted} shift(s)`);
        if (projectsAdded > 0) descriptionParts.push(`created ${projectsAdded} new project(s)`);

        if (descriptionParts.length > 0) {
            toast({
                title: 'Import Complete',
                description: `Successfully processed the file: ${descriptionParts.join(', ')}.`,
            });
        } else if (unknownOperativesCount.size === 0) {
            toast({
                title: 'No Changes Detected',
                description: "The schedule was up-to-date. No changes were made.",
            });
        }
        
        if (unknownOperativesCount.size > 0) {
            const unknownOperativesSummary = Array.from(unknownOperativesCount.entries())
                .map(([name, count]) => `${name} (${count} shift${count > 1 ? 's' : ''})`)
                .join(', ');

            toast({
                variant: 'destructive',
                title: 'Unrecognized Operatives',
                description: `Shifts for the following were skipped: ${unknownOperativesSummary}. Please check spelling or add them as users.`,
                duration: 10000,
            });
        }

        setFile(null);
        const fileInput = document.getElementById('shift-file-input') as HTMLInputElement;
        if (fileInput) fileInput.value = "";

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
