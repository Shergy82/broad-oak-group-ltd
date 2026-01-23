'use client';

import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'BROAD OAK GROUP',
  description: 'Live schedule and project management for Broad Oak Group operatives.',
  metadataBase: new URL('https://group-build-29768421-feed1.web.app'),
  openGraph: {
    title: 'BROAD OAK GROUP',
    description: 'Live schedule and project management for Broad Oak Group operatives.',
    url: '/',
    siteName: 'BROAD OAK GROUP',
    images: [
      {
        url: '/icons/notification-banner.png',
        width: 1200,
        height: 630,
        alt: 'Broad Oak Group',
      },
    ],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'BROAD OAK GROUP',
    description: 'Live schedule and project management for Broad Oak Group operatives.',
    images: ['/icons/notification-banner.png'],
  },
  icons: {
    icon: '/favicon.ico',
    apple: '/favicon.ico',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#ffffff" />
      </head>
      <body className="font-body antialiased h-full">{children}</body>
    </html>
  );
}
