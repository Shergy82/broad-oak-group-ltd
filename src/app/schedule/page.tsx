'use client';

import { ShiftScheduleOverview } from '@/components/admin/shift-schedule-overview';
import { useAuth } from '@/hooks/use-auth';
import { useUserProfile } from '@/hooks/use-user-profile';
import { Spinner } from '@/components/shared/spinner';

export default function TeamSchedulePage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const { userProfile, loading: isProfileLoading } = useUserProfile();

  if (isAuthLoading || isProfileLoading) {
    return (
      <div className="p-6 flex justify-center items-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!user) {
    // This should ideally be handled by a layout or middleware, but for now, this is a safe guard.
    return <div className="p-6">Please sign in to view the schedule.</div>;
  }

  if (!userProfile) {
    return <div className="p-6">Your user profile could not be loaded. Please try refreshing the page.</div>;
  }

  return <ShiftScheduleOverview userProfile={userProfile} />;
}
