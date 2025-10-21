'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FileUploader, FailedShift, ReconciliationResult } from '@/components/admin/file-uploader';
import { useUserProfile } from '@/hooks/use-user-profile';

export default function AdminPageContent() {
  const { userProfile } = useUserProfile();
  
  const isPrivilegedUser = userProfile && ['admin', 'owner'].includes(userProfile.role);

  const handleImportComplete = (failedShifts: FailedShift[], dryRunData?: ReconciliationResult) => {
    // This function will be expanded in later steps
  };
  
  const handleFileSelection = () => {
    // This function will be expanded in later steps
  };

  return (
    <div className="space-y-8">
      {isPrivilegedUser && (
        <Card>
          <CardHeader>
            <CardTitle>Import Weekly Shifts from Excel</CardTitle>
            <CardDescription>
              Upload an Excel workbook to import, update, or delete shifts in bulk.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FileUploader onImportComplete={handleImportComplete} onFileSelect={handleFileSelection} />
          </CardContent>
        </Card>
      )}

      {/* The results of the import will be rendered here in future steps */}

    </div>
  );
}
