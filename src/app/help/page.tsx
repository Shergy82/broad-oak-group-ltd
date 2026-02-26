'use client';

import { Faq } from '@/components/landing/faq';
import { useUserProfile } from '@/hooks/use-user-profile';
import { Spinner } from '@/components/shared/spinner';

export default function HelpPage() {
  const { userProfile, loading } = useUserProfile();

  if (loading) {
    return (
      <div className="flex justify-center p-6">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Help & Support</h1>
      <Faq role={userProfile?.role} />
    </div>
  );
}
