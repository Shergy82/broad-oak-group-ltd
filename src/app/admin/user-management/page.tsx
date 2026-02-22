
'use client';

import { UserManagement } from '@/components/admin/user-management';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useUserProfile } from '@/hooks/use-user-profile';
import { Spinner } from '@/components/shared/spinner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertTriangle } from 'lucide-react';

export default function UserManagementPage() {
  const { userProfile, loading } = useUserProfile();

  if (loading) {
    return (
      <div className="flex justify-center p-6">
        <Spinner size="lg" />
      </div>
    );
  }

  if (userProfile?.role !== 'owner') {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Access Denied</AlertTitle>
        <AlertDescription>
          You do not have permission to view this page. User management is restricted to owners.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>User Management</CardTitle>
        <CardDescription>
          Approve new users, manage roles, and suspend or delete accounts.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <UserManagement />
      </CardContent>
    </Card>
  );
}
