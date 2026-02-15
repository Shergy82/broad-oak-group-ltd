import type { Metadata, Viewport } from 'next';

import { Providers } from '@/components/providers';
import { Header } from '@/components/layout/header';
import { PendingAnnouncementModal } from '@/components/announcements/pending-announcement-modal';

import './globals.css';

const siteUrl = `https://${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}.web.app`;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: 'Broad Oak Group',
  description:
    'Broad Oak Group internal portal for scheduling, projects and site management.',
  manifest: '/manifest.json',

  openGraph: {
    title: 'Broad Oak Group',
    description:
      'Broad Oak Group internal portal for scheduling, projects and site management.',
    url: '/',
    siteName: 'Broad Oak Group',
    images: [
      {
        url: '/icon-512.png',
        width: 512,
        height: 512,
        alt: 'Broad Oak Group Logo',
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
    images: ['/icon-512.png'],
  },

  icons: {
    icon: '/icon-192.png',
    apple: '/icon-192.png',
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
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossOrigin=""/>
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
