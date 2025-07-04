
'use client';

import { Toaster } from "@/components/ui/toaster";
import "./globals.css";
import { AuthProvider } from "@/components/auth-provider";
import { UserProfileProvider } from "@/components/user-profile-provider";
import { ServiceWorkerRegistrar } from "@/components/service-worker-registrar";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <head>
        <title>Broad Oak Build Live</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=PT+Sans:wght@400;700&display=swap" rel="stylesheet" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#ffffff" />
      </head>
      <body className="font-body antialiased h-full">
        <AuthProvider>
          <UserProfileProvider>
            <ServiceWorkerRegistrar />
            {children}
            <Toaster />
          </UserProfileProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
