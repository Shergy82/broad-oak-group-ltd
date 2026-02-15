'use client';

import { useUserProfile } from '@/hooks/use-user-profile';
import { StaffAIWidget } from '@/components/admin/staff-ai-widget';
import { ProjectMap } from '@/components/admin/ProjectMap'; 
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/shared/spinner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertTriangle } from 'lucide-react';

export default function StaffAIPage() {
    const { userProfile, loading } = useUserProfile();
    
    if (loading) {
        return (
            <div className="flex justify-center p-6">
                <Spinner size="lg" />
            </div>
        )
    }

    if (!userProfile) {
        return (
            <div className="p-6 text-center text-muted-foreground">
                Could not load user profile.
            </div>
        )
    }

    const isPrivileged = ['admin', 'owner', 'manager'].includes(userProfile.role);

    if (!isPrivileged) {
        return (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Access Denied</AlertTitle>
            <AlertDescription>
              You do not have permission to view this page.
            </AlertDescription>
          </Alert>
        );
    }


    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Staff AI Assistant</CardTitle>
            <CardDescription>
              Ask questions or get help with tasks.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <StaffAIWidget userProfile={userProfile} />
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle>Project Locations</CardTitle>
            <CardDescription>
              An overview of all active project locations.
            </CardDescription>
          </CardHeader>
          <CardContent>
             <ProjectMap />
          </CardContent>
        </Card>
      </div>
    );
}
