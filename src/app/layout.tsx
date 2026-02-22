import type { Metadata, Viewport } from 'next';

import { Providers } from '@/components/providers';
import { Header } from '@/components/layout/header';
import { PendingAnnouncementModal } from '@/components/announcements/pending-announcement-modal';

import './globals.css';

const siteUrl = `https://broad-oak-group-ltd--the-final-project-5e248.europe-west4.hosted.app`;

export const metadata: Metadata = {
  // No metadataBase, use absolute URLs
  title: 'Broad Oak Group',
  description:
    'Broad Oak Group internal portal for scheduling, projects and site management.',
  manifest: '/manifest.json',

  openGraph: {
    title: 'Broad Oak Group',
    description:
      'Broad Oak Group internal portal for scheduling, projects and site management.',
    url: siteUrl, // Absolute URL
    siteName: 'Broad Oak Group',
    images: [
      {
        url: 'https://images.unsplash.com/photo-1581091226825-a6a2a5aee158', // Simple, static, reliable JPG
        width: 1200,
        height: 630,
        alt: 'Broad Oak Group',
      },
    ],
    locale: 'en_GB',
    type: 'website',
  },

  twitter: {
    card: 'summary_large_image',
    title: 'Broad Oak Group',
    description:
      'Broad Oak Group internal portal for scheduling, projects and site management.',
    images: ['https://images.unsplash.com/photo-1581091226825-a6a2a5aee158'],
  },

  icons: {
    icon: '/icon.svg',
    apple: '/icon.svg',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full">
       <head>
        
      </head>
      <body className="h-full font-body antialiased overflow-x-hidden bg-background">
        <Providers>
          <PendingAnnouncementModal />

          <div className="flex min-h-screen flex-col">
            <Header />

            <main className="flex-1 w-full">
              <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-6">
                {children}
              </div>
            </main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
