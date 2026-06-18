'use client';

import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { FileUploader } from './file-uploader';
import type { UserProfile } from '@/types';
import { Button } from '@/components/ui/button';
import { db, functions, httpsCallable } from '@/lib/firebase';
import { collection, getDocs, addDoc, serverTimestamp } from 'firebase/firestore';
import { ImportWizard } from './import-wizard';
import { type UnifiedParseResult } from '@/lib/exceljs-parser';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';

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
      
      // We pass the standardized shifts to the backend
      // The backend handles the creation/update logic
      await reconcileShifts({
        toCreate: wizardData.shifts.map(s => ({
          ...s,
          date: s.date.toISOString(),
          status: 'pending-confirmation',
          source: 'import'
        })),
        toUpdate: [], // Refined multi-profile updates handled in next phase
        toDelete: [],
        department: userProfile.department || 'Gas'
      });

      // Log the import
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

  return (
    <div className="space-y-6">
      {!wizardData ? (
        <Card>
          <CardHeader>
            <CardTitle>Schedule Import Hub</CardTitle>
            <CardDescription>Upload client planners. The system will automatically detect the layout and validate the data.</CardDescription>
          </CardHeader>
          <CardContent>
            <FileUploader 
              onImportComplete={handleImportComplete} 
              userProfile={userProfile} 
            />
          </CardContent>
        </Card>
      ) : (
        <ImportWizard 
          data={wizardData} 
          onConfirm={handleFinalPublish} 
          onCancel={() => setImportResults(null)} 
        />
      )}
    </div>
  );
}
