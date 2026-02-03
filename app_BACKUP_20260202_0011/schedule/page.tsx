'use client';

import { ShiftScheduleOverview } from '@/components/admin/shift-schedule-overview';
import { Spinner } from '@/components/shared/spinner';
import { useUserProfile } from '@/hooks/use-user-profile';

export default function SchedulePage() {
    const { userProfile, loading } = useUserProfile();

    // The parent layout handles the "not logged in" and "not admin/owner" cases.
    // We just need to wait for the profile to load.
    if (loading) {
        return (
            <div className="flex h-48 w-full items-center justify-center">
                <Spinner size="lg" />
            </div>
        );
    }
    
    if (!userProfile) {
        // This case should ideally not be hit due to the layout protection,
        // but it's good practice to handle it.
        return null;
    }

    return (
        <ShiftScheduleOverview userProfile={userProfile} />
    );
}
