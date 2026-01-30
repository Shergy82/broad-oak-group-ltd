import type { Metadata } from "next";
import { Providers } from "@/components/providers";
import "./globals.css";

const siteUrl = `https://${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}.web.app`;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Broad Oak Group",
  description: "Broad Oak Group internal portal for scheduling, projects and site management.",
  manifest: "/manifest.json",
  openGraph: {
    title: "Broad Oak Group",
    description: "Broad Oak Group internal portal for scheduling, projects and site management.",
    url: '/',
    siteName: 'Broad Oak Group',
    images: [
      {
        url: '/icon-512.png', // Relative to metadataBase
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
    title: "Broad Oak Group",
    description: "Broad Oak Group internal portal for scheduling, projects and site management.",
    images: [`/icon-512.png`],
  },
  icons: {
    icon: '/icon-192.png',
    apple: '/icon-192.png',
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
        <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
        <meta name="theme-color" content="#ffffff" />
      </head>
      <body className="font-body antialiased h-full">
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
