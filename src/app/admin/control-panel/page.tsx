'use client';

import { Spinner } from '@/components/shared/spinner';
import dynamic from 'next/dynamic';

const AdminPageContent = dynamic(
  () => import('@/components/admin/admin-page-content'),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-96 w-full items-center justify-center">
        <Spinner size="lg" />
      </div>
    ),
  }
);

export default function ControlPanelPage() {
  return <AdminPageContent />;
}
