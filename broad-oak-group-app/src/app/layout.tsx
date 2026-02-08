
'use client';

import { Toaster } from "@/components/ui/toaster";
import "./globals.css";
import { AuthProvider } from "@/components/auth-provider";
import { UserProfileProvider } from "@/components/user-profile-provider";
import { ServiceWorkerRegistrar } from "@/components/service-worker-registrar";
import { usePathname } from "next/navigation";
import { Header } from "@/components/layout/header";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const pathname = usePathname();
  const noHeaderPaths = ['/login', '/signup', '/forgot-password'];
  const showHeader = !noHeaderPaths.includes(pathname) && pathname !== '/';

  return (
    <html lang="en" className="h-full">
      <head>
        <title>Broad Oak Build Live</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#ffffff" />
      </head>
      <body className="font-body antialiased h-full">
        <AuthProvider>
          <UserProfileProvider>
            <ServiceWorkerRegistrar />
            {showHeader ? (
              <div className="flex min-h-screen w-full flex-col">
                <Header />
                {children}
              </div>
            ) : (
              children
            )}
            <Toaster />
          </UserProfileProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
