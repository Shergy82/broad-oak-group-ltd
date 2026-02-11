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

/**
 * This is the CORRECT way to define viewport in Next.js App Router
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full">
      <body className="font-body antialiased h-full">
        <Providers>
          <PendingAnnouncementModal />

          <div className="min-h-screen flex flex-col">
            <Header />

            <main className="flex-1">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
                {children}
              </div>
            </main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
