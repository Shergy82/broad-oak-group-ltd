'use client';

import { Toaster } from '@/components/ui/toaster';
import { AuthProvider } from '@/components/auth-provider';
import { UserProfileProvider } from '@/components/user-profile-provider';
import { ServiceWorkerRegistrar } from '@/components/service-worker-registrar';
import { DepartmentFilterProvider } from './department-filter-provider';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <UserProfileProvider>
        <DepartmentFilterProvider>
          {/* ✅ SINGLE, CORRECT SERVICE WORKER REGISTRATION */}
          <ServiceWorkerRegistrar />

          {children}

          <Toaster />
        </DepartmentFilterProvider>
      </UserProfileProvider>
    </AuthProvider>
  );
}
