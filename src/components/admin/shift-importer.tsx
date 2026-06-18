'use client';

import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FileUploader } from './file-uploader';
import type { UserProfile } from '@/types';
import { Button } from '@/components/ui/button';
import { db, functions, httpsCallable } from '@/lib/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { ImportWizard } from './import-wizard';
import { type UnifiedParseResult } from '@/lib/exceljs-parser';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AlertCircle, FileSearch, CheckCircle, Info, HelpCircle, Table as TableIcon, LayoutGrid } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

interface ShiftImporterProps {
  userProfile: UserProfile;
}

export function ShiftImporter({ userProfile }: ShiftImporterProps) {
  const { user } = useAuth();
  const [wizardData, setImportResults] = useState<UnifiedParseResult | null>(null);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const { toast } = useToast();

  const handleImportComplete = (result: UnifiedParseResult) => {
    setImportResults(result);
    setIsConfirmed(false);
  };

  const handleFinalPublish = async () => {
    if (!wizardData || !user) return;

    try {
      if (!functions) throw new Error("Functions not available");
      const reconcileShifts = httpsCallable(functions, 'reconcileShifts');
      
      await reconcileShifts({
        toCreate: wizardData.shifts.map(s => ({
          ...s,
          date: s.date.toISOString(),
          status: 'pending-confirmation',
          source: 'import'
        })),
        toUpdate: [],
        toDelete: [],
        department: userProfile.department || 'Gas'
      });

      await addDoc(collection(db, 'import_logs'), {
        fileName: 'Spreadsheet Import',
        importerUid: user.uid,
        importerName: userProfile.name,
        profileId: wizardData.profileId,
        rowCount: wizardData.shifts.length,
        shiftCount: wizardData.shifts.length,
        errorCount: 0,
        warningCount: wizardData.errors.length,
        timestamp: serverTimestamp(),
        result: 'success'
      });

      toast({ title: 'Success', description: `${wizardData.shifts.length} shifts published.` });
      setImportResults(null);
      setIsConfirmed(true);
    } catch (err: any) {
      console.error("Publish failed:", err);
      toast({ variant: 'destructive', title: 'Publish Failed', description: err.message });
    }
  };

  const diagnosticLogs = useMemo(() => {
    if (!wizardData) return [];
    return wizardData.errors.filter(e => e.severity === 'debug' || e.severity === 'info' || e.severity === 'warning');
  }, [wizardData]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold tracking-tight">Shift Importer</h2>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              <HelpCircle className="mr-2 h-4 w-4" />
              Supported Layouts
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Expected Planner Layouts</DialogTitle>
              <DialogDescription>
                The importer supports two primary layouts. Ensure your file matches one of these structures.
              </DialogDescription>
            </DialogHeader>
            <ScrollArea className="max-h-[70vh] pr-4">
              <div className="space-y-8 py-4">
                {/* 1. Tabular Layout */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 font-semibold text-primary">
                    <TableIcon className="h-5 w-5" />
                    <h3>Standard Tabular (Build/Generic)</h3>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    A simple list where each row is a shift. Ideal for Build and Solar planners.
                  </p>
                  <div className="border rounded-md p-4 bg-muted/30">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-muted border-b">
                          <th className="p-2 border-r text-left">Date</th>
                          <th className="p-2 border-r text-left">Staff</th>
                          <th className="p-2 border-r text-left">Site Address</th>
                          <th className="p-2 text-left">Description</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-b bg-background">
                          <td className="p-2 border-r italic">01/10/24</td>
                          <td className="p-2 border-r italic">John Smith</td>
                          <td className="p-2 border-r italic">10 Downing Street</td>
                          <td className="p-2 italic">Boiler Service</td>
                        </tr>
                        <tr className="border-b bg-background">
                          <td className="p-2 border-r text-muted-foreground italic">(Blank)</td>
                          <td className="p-2 border-r text-muted-foreground italic">(Blank)</td>
                          <td className="p-2 border-r italic">12 Baker Street</td>
                          <td className="p-2 italic">Gas Safety Check</td>
                        </tr>
                      </tbody>
                    </table>
                    <p className="text-[10px] text-muted-foreground mt-2 italic">
                      * Blank cells in Date/Staff will automatically carry down the value from above.
                    </p>
                  </div>
                </div>

                {/* 2. Battleship Layout */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 font-semibold text-sky-600">
                    <LayoutGrid className="h-5 w-5" />
                    <h3>Battleship Layout (Gas Department)</h3>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    A grid-based layout where site addresses are in Column A and dates are across the top.
                  </p>
                  <div className="border rounded-md p-4 bg-muted/30">
                    <div className="space-y-1">
                      <div className="h-2 bg-black w-full rounded-sm opacity-50" title="Colored Divider Row" />
                      <table className="w-full text-[10px] border-collapse bg-background">
                        <thead>
                          <tr className="bg-muted/50 border-b">
                            <th className="p-1 border-r text-left w-1/4">Col A (Address)</th>
                            <th className="p-1 border-r text-center">Col F (01/10)</th>
                            <th className="p-1 border-r text-center">Col G (02/10)</th>
                            <th className="p-1 text-center">Col H (03/10)</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="border-b">
                            <td className="p-1 border-r font-bold">16 Hints Meadow</td>
                            <td className="p-1 border-r text-center">John Smith</td>
                            <td className="p-1 border-r text-center">Jane Doe</td>
                            <td className="p-1 text-center text-muted-foreground">-</td>
                          </tr>
                          <tr className="border-b">
                            <td className="p-1 border-r"></td>
                            <td className="p-1 border-r text-center text-muted-foreground">Task Details...</td>
                            <td className="p-1 border-r text-center text-muted-foreground">Task Details...</td>
                            <td className="p-1 text-center text-muted-foreground">-</td>
                          </tr>
                        </tbody>
                      </table>
                      <div className="h-2 bg-black w-full rounded-sm opacity-50" />
                    </div>
                    <ul className="text-[10px] text-muted-foreground mt-3 list-disc pl-4 space-y-1">
                      <li>Colored dividers (black/solid) define the site blocks.</li>
                      <li>Operative names must be found in the system to be mapped.</li>
                      <li>Dates should be formatted clearly or as Excel serial numbers.</li>
                    </ul>
                  </div>
                </div>
              </div>
            </ScrollArea>
          </DialogContent>
        </Dialog>
      </div>

      {!wizardData ? (
        <Card>
          <CardHeader>
            <CardTitle>Upload Planner</CardTitle>
            <CardDescription>Upload client planners for automated shift processing. We support Broad Oak Gas, Connexus, and standard tabular formats.</CardDescription>
          </CardHeader>
          <CardContent>
            <FileUploader 
              onImportComplete={handleImportComplete} 
              userProfile={userProfile} 
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <ImportWizard 
            data={wizardData} 
            onConfirm={handleFinalPublish} 
            onCancel={() => setImportResults(null)} 
          />

          {wizardData.shifts.length === 0 && (
            <Card className="border-amber-200 bg-amber-50">
              <CardHeader>
                <div className="flex items-center gap-2 text-amber-900">
                  <FileSearch className="h-5 w-5" />
                  <CardTitle>Diagnostic Results: 0 Shifts Found</CardTitle>
                </div>
                <CardDescription className="text-amber-800">
                  We scanned the spreadsheet but could not extract any valid shifts. Review the logs below to see why.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[400px] rounded-md border border-amber-200 bg-white p-4">
                  <div className="space-y-4">
                    {diagnosticLogs.length > 0 ? (
                      diagnosticLogs.map((log, i) => (
                        <div key={i} className="flex flex-col border-b border-muted pb-3 last:border-0">
                          <div className="flex items-center justify-between mb-1">
                            <Badge variant={log.severity === 'warning' ? 'destructive' : 'outline'} className="text-[10px]">
                              {log.code}
                            </Badge>
                            <span className="text-[10px] text-muted-foreground">
                              {log.sheet} {log.row ? `• Row ${log.row}` : ''}
                            </span>
                          </div>
                          <p className="text-sm font-medium">{log.message}</p>
                          {log.rawValues && (
                            <div className="mt-2 bg-muted/30 p-2 rounded text-[10px] font-mono whitespace-pre-wrap">
                              Data Found: {JSON.stringify(log.rawValues, null, 2)}
                            </div>
                          )}
                        </div>
                      ))
                    ) : (
                      <p className="text-center text-muted-foreground py-8">No specific row errors found. Please check if your file has hidden sheets or unusual formatting.</p>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
