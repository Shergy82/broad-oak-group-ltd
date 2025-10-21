
'use client';

import { useState } from 'react';
import * as XLSX from 'xlsx';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/shared/spinner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Upload, FileWarning, Sheet, TableIcon } from 'lucide-react';
import { Label } from '../ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';

// Redefine this for our diagnostic purposes
export interface DiagnosticCell {
  sheetName: string;
  rowNumber: number;
  column: string;
  content: string;
}

interface FileUploaderProps {
  // These props are kept for future compatibility but are not used by the diagnostic version.
  onImportComplete: (failedShifts: any[], dryRunResult?: any) => void;
  onFileSelect: () => void;
  shiftsToPublish?: any | null;
  children?: React.ReactNode;
}

export function FileUploader({ onImportComplete, onFileSelect }: FileUploaderProps) {
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [enabledSheets, setEnabledSheets] = useState<{ [key: string]: boolean }>({});
  const [diagnosticData, setDiagnosticData] = useState<DiagnosticCell[]>([]);
  const { toast } = useToast();


  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      const selectedFile = event.target.files[0];
      if (selectedFile) {
        setFile(selectedFile);
        setError(null);
        setDiagnosticData([]);
        onFileSelect(); // Clear previous reports in parent

        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const data = e.target?.result;
            if (!data) throw new Error("Could not read file.");
            const workbook = XLSX.read(data, { type: 'array', bookSheets: true });
            const names = workbook.SheetNames;
            setSheetNames(names);
            const initialEnabled: { [key: string]: boolean } = {};
            names.forEach(name => {
              initialEnabled[name] = true;
            });
            setEnabledSheets(initialEnabled);
          } catch (err: any) {
             setError(`Error reading workbook structure: ${err.message}`);
          }
        };
        reader.onerror = () => {
           setError(`Failed to read the file.`);
        }
        reader.readAsArrayBuffer(selectedFile);
      }
    }
  };

  const toggleSheet = (sheetName: string, isEnabled: boolean) => {
    setEnabledSheets(prev => ({ ...prev, [sheetName]: isEnabled }));
  }

  const handleProcessFile = async () => {
    if (!file) {
      setError('Please select a file first.');
      return;
    }

    setIsProcessing(true);
    setError(null);
    setDiagnosticData([]);
    toast({ title: "Reading File...", description: "Displaying all cell data for diagnostics." });

    // Use a timeout to ensure the UI updates before the heavy processing begins
    setTimeout(() => {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const data = e.target?.result;
            if (!data) {
                 throw new Error("Could not read file data.");
            }
            
            const workbook = XLSX.read(data, { type: 'array' });
            
            const allCells: DiagnosticCell[] = [];
    
            workbook.SheetNames.forEach(sheetName => {
                if (!enabledSheets[sheetName]) {
                    return; // Skip disabled sheet
                }
                
                const sheet = workbook.Sheets[sheetName];
                const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
    
                for (let R = range.s.r; R <= range.e.r; R++) {
                    for (let C = range.s.c; C <= range.e.c; C++) {
                        const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
                        const cell = sheet[cellAddress];
                        
                        if (cell && cell.v !== undefined) {
                            const cellValue = String(cell.w || cell.v || '').trim();
                            if (cellValue) {
                                allCells.push({
                                  sheetName,
                                  rowNumber: R + 1,
                                  column: XLSX.utils.encode_col(C),
                                  content: cellValue,
                                });
                            }
                        }
                    }
                }
            });
            
            setDiagnosticData(allCells);
            toast({ title: "Diagnostic Complete", description: `Found ${allCells.length} non-empty cells.` });
    
          } catch (err: any) {
            console.error("Fatal error during file processing:", err);
            setError(`Failed to process file. Error: ${err.message}`);
            toast({ variant: "destructive", title: "Processing Error", description: err.message });
          } finally {
            setIsProcessing(false);
          }
        };
        reader.onerror = () => {
            setError('Failed to read file buffer.');
            setIsProcessing(false);
        }
        reader.readAsArrayBuffer(file);
    }, 100);
  };
  
  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <FileWarning className="h-4 w-4" />
          <AlertTitle>Import Error</AlertTitle>
          <AlertDescription style={{ whiteSpace: 'pre-wrap' }}>{error}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-4">
        <Input
          id="shift-file-input"
          type="file"
          accept=".xlsx, .xls, .xlsb"
          onChange={handleFileChange}
          className="w-full file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer"
        />

        {sheetNames.length > 0 && (
          <div className="space-y-3 rounded-lg border p-4">
            <h3 className="text-sm font-medium">Select Sheets to Read</h3>
            <div className="space-y-2">
              {sheetNames.map(name => (
                <div key={name} className="flex items-center justify-between rounded-md border p-3">
                  <Label htmlFor={`sheet-${name}`} className="flex items-center gap-2 text-sm font-normal">
                    <Sheet className="h-4 w-4 text-muted-foreground" />
                    {name}
                  </Label>
                  <Switch
                    id={`sheet-${name}`}
                    checked={!!enabledSheets[name]}
                    onCheckedChange={(checked) => toggleSheet(name, checked)}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-4 items-center">
          <Button onClick={handleProcessFile} disabled={!file || isProcessing} className="w-full sm:w-auto ml-auto">
            {isProcessing ? <Spinner /> : <><Upload className="mr-2 h-4 w-4" /> Read File & Display Data</>}
          </Button>
        </div>
      </div>
      
      {diagnosticData.length > 0 && (
        <div className="space-y-4 pt-6">
            <div className="flex items-center gap-3">
                <TableIcon className="h-6 w-6 text-primary" />
                <h3 className="text-lg font-semibold">Diagnostic Raw Cell Data</h3>
            </div>
            <p className="text-sm text-muted-foreground">
                This table shows all non-empty cells found in the selected sheets.
            </p>
            <ScrollArea className="h-[500px] border rounded-lg">
                <Table>
                    <TableHeader className="sticky top-0 bg-muted/95 backdrop-blur-sm">
                        <TableRow>
                            <TableHead>Sheet</TableHead>
                            <TableHead>Row</TableHead>
                            <TableHead>Col</TableHead>
                            <TableHead>Content</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {diagnosticData.map((cell, index) => (
                            <TableRow key={index}>
                                <TableCell>{cell.sheetName}</TableCell>
                                <TableCell>{cell.rowNumber}</TableCell>
                                <TableCell>{cell.column}</TableCell>
                                <TableCell className="font-mono text-xs">{cell.content}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </ScrollArea>
        </div>
      )}
    </div>
  );
}
