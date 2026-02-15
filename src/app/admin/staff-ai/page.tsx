'use client';

import { useUserProfile } from '@/hooks/use-user-profile';
import { StaffAIWidget } from '@/components/admin/staff-ai-widget';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/shared/spinner';

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

    return (
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
      );
}
