
'use client';

import { useUserProfile } from '@/hooks/use-user-profile';
import dynamic from 'next/dynamic';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

import { Spinner } from '@/components/shared/spinner';

const StaffShiftMap = dynamic(
  () => import('@/components/admin/StaffShiftMap').then((mod) => mod.StaffShiftMap),
  {
    ssr: false,
    loading: () => <div className="h-[500px] rounded-md bg-muted flex items-center justify-center"><Spinner size="lg" /></div>
  }
);


export default function AIPage() {
  const { userProfile, loading } = useUserProfile();

  if (loading) {
    return (
      <div className="flex justify-center p-6">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>AI Assistant & Mapping</CardTitle>
          <CardDescription>
            Live view of staff locations for today.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <StaffShiftMap />
        </CardContent>
      </Card>
    </div>
  );
}
