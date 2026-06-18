'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Spinner } from '@/components/shared/spinner';
import { 
  CheckCircle2, 
  AlertCircle, 
  AlertTriangle, 
  FileText, 
  Users, 
  MapPin, 
  Calendar,
  XCircle,
  ArrowRight,
  Info
} from 'lucide-react';
import { format } from 'date-fns';
import { type StandardShift, type ImportError } from '@/lib/importer/types';
import { cn } from '@/lib/utils';

interface ImportWizardProps {
  data: {
    shifts: StandardShift[];
    errors: ImportError[];
    profileName: string;
    profileId: string;
  };
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

export function ImportWizard({ data, onConfirm, onCancel }: ImportWizardProps) {
  const [isPublishing, setIsPublishing] = useState(false);
  const { shifts, errors, profileName } = data;

  const errorCount = errors.filter(e => e.severity === 'error').length;
  const warningCount = errors.filter(e => e.severity === 'warning').length;
  const uniqueOperatives = new Set(shifts.map(s => s.operative)).size;

  const canPublish = errorCount === 0 && shifts.length > 0;

  const handleConfirm = async () => {
    setIsPublishing(true);
    try {
      await onConfirm();
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Header & Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-primary/5 border-primary/20">
          <CardHeader className="p-4 pb-2"><CardTitle className="text-xs font-bold uppercase text-muted-foreground flex items-center gap-2"><FileText className="h-3 w-3" /> Profile</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0"><p className="text-lg font-bold truncate">{profileName}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="p-4 pb-2"><CardTitle className="text-xs font-bold uppercase text-muted-foreground flex items-center gap-2"><Calendar className="h-3 w-3" /> Shifts</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0"><p className="text-2xl font-bold">{shifts.length}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="p-4 pb-2"><CardTitle className="text-xs font-bold uppercase text-muted-foreground flex items-center gap-2"><Users className="h-3 w-3" /> Staff</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0"><p className="text-2xl font-bold">{uniqueOperatives}</p></CardContent>
        </Card>
        <Card className={cn(errorCount > 0 ? "bg-destructive/5 border-destructive/20" : "bg-green-50 border-green-200")}>
          <CardHeader className="p-4 pb-2"><CardTitle className="text-xs font-bold uppercase text-muted-foreground flex items-center gap-2">{errorCount > 0 ? <XCircle className="h-3 w-3 text-destructive" /> : <CheckCircle2 className="h-3 w-3 text-green-600" />} Issues</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0"><p className={cn("text-2xl font-bold", errorCount > 0 && "text-destructive")}>{errorCount}</p></CardContent>
        </Card>
      </div>

      {/* 2. Error/Warning Messages */}
      {errors.length > 0 && (
        <Alert variant={errorCount > 0 ? "destructive" : "default"} className={cn(errorCount === 0 && "bg-amber-50 border-amber-200 text-amber-900")}>
          {errorCount > 0 ? <AlertCircle className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4 text-amber-600" />}
          <AlertTitle>{errorCount > 0 ? 'Validation Errors Detected' : 'Import Warnings'}</AlertTitle>
          <AlertDescription>
            <ScrollArea className="h-24 mt-2">
              <ul className="text-xs space-y-1">
                {errors.slice(0, 15).map((err, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <Badge variant={err.severity === 'error' ? 'destructive' : 'outline'} className="text-[9px] px-1 py-0 h-4">
                      {err.cell || 'Row ' + err.row}
                    </Badge>
                    {err.message}
                  </li>
                ))}
                {errors.length > 15 && <li className="italic opacity-70">And {errors.length - 15} more issues...</li>}
              </ul>
            </ScrollArea>
          </AlertDescription>
        </Alert>
      )}

      {!canPublish && shifts.length > 0 && (
        <div className="bg-muted p-4 rounded-lg flex items-center gap-3">
          <Info className="h-5 w-5 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">You must fix the critical errors in your Excel file before you can publish these shifts.</p>
        </div>
      )}

      {/* 3. Data Preview Table */}
      <Card>
        <CardHeader className="py-4">
          <CardTitle className="text-sm font-semibold">Data Preview</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[400px]">
            <Table>
              <TableHeader className="sticky top-0 bg-background z-10">
                <TableRow>
                  <TableHead className="w-[120px]">Date</TableHead>
                  <TableHead>Operative</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Task</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shifts.map((s, i) => {
                  const hasError = errors.some(e => e.row === i + 1 && e.severity === 'error');
                  return (
                    <TableRow key={i} className={cn(hasError && "bg-destructive/5 hover:bg-destructive/10")}>
                      <TableCell className="font-medium text-xs">
                        {isNaN(s.date.getTime()) ? <span className="text-destructive font-bold">INVALID</span> : format(s.date, 'EEE, dd MMM')}
                      </TableCell>
                      <TableCell className="text-xs font-semibold">{s.operative}</TableCell>
                      <TableCell className="text-[10px] leading-tight">
                        <div className="flex flex-col">
                          <span>{s.address}</span>
                          <span className="opacity-60">{s.contract}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-[10px] italic max-w-[200px] truncate">{s.task}</TableCell>
                      <TableCell className="text-right">
                        {hasError ? <Badge variant="destructive" className="text-[9px]">Fix Needed</Badge> : <Badge variant="outline" className="text-[9px] capitalize">{s.type}</Badge>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* 4. Action Footer */}
      <div className="flex justify-between items-center pt-4">
        <Button variant="ghost" onClick={onCancel} disabled={isPublishing}>Cancel Import</Button>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">{shifts.length} records ready</span>
          <Button size="lg" onClick={handleConfirm} disabled={!canPublish || isPublishing}>
            {isPublishing ? <Spinner className="mr-2" /> : <><CheckCircle2 className="mr-2 h-4 w-4" /> Publish to Schedule</>}
          </Button>
        </div>
      </div>
    </div>
  );
}
