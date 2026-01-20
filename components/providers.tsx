'use client';

import { Toaster } from "@/components/ui/toaster";
import { AuthProvider } from "@/components/auth-provider";
import { UserProfileProvider } from "@/components/user-profile-provider";
import { ServiceWorkerRegistrar } from "@/components/service-worker-registrar";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <UserProfileProvider>
        <ServiceWorkerRegistrar />
        {children}
        <Toaster />
      </UserProfileProvider>
    </AuthProvider>
  );
}
