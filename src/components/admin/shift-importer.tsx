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
import { AlertCircle, FileSearch, CheckCircle, Info } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

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
      {!wizardData ? (
        <Card>
          <CardHeader>
            <CardTitle>Schedule Import Hub</CardTitle>
            <CardDescription>Upload client planners. Supports Broad Oak, Connexus, and Standard Tabular formats.</CardDescription>
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
