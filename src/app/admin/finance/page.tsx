'use client';

import { useUserProfile } from '@/hooks/use-user-profile';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Spinner } from '@/components/shared/spinner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertTriangle, Construction } from 'lucide-react';

export default function FinancePage() {
  const { userProfile, loading } = useUserProfile();

  if (loading) {
    return (
      <div className="flex justify-center p-6">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!userProfile || userProfile.department !== 'Build') {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Access Denied</AlertTitle>
        <AlertDescription>
          You do not have permission to view this page. It is restricted to the Build department.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Finance Dashboard (Build Department)</CardTitle>
          <CardDescription>
            Financial overview and tools for the Build department.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 text-center h-96">
            <Construction className="mx-auto h-12 w-12 text-muted-foreground" />
            <h3 className="mt-4 text-lg font-semibold">Under Construction</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              This finance page is being built.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
