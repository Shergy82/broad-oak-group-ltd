import type { Metadata, Viewport } from 'next';

import { Providers } from '@/components/providers';
import { Header } from '@/components/layout/header';
import { PendingAnnouncementModal } from '@/components/announcements/pending-announcement-modal';

import './globals.css';

const siteUrl =
  'https://broad-oak-group-ltd--the-final-project-5e248.europe-west4.hosted.app';

export const metadata: Metadata = {
  title: 'Broad Oak Group',

  // 🔒 Locks canonical + prevents reuse of old cached OG data
  metadataBase: new URL(siteUrl),

  openGraph: {
    title: 'Broad Oak Group',
    url: siteUrl,
    siteName: 'Broad Oak Group',
    type: 'website',
    images: [
      {
        url: '/og-image.png', // resolved via metadataBase
        width: 1200,
        height: 630,
        alt: 'Broad Oak Group',
      },
    ],
  },

  twitter: {
    card: 'summary_large_image',
    title: 'Broad Oak Group',
    images: ['/og-image.png'],
  },

  icons: {
    icon: '/icon.svg',
    apple: '/icon.svg',
  },

  manifest: '/manifest.json',
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