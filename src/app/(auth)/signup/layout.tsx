import type { Metadata } from 'next';

const siteUrl =
  'https://broad-oak-group-ltd--the-final-project-5e248.europe-west4.hosted.app';

export const metadata: Metadata = {
  title: 'Broad Oak Group',

  // 🚫 Explicitly disable descriptions
  description: '',

  openGraph: {
    title: 'Broad Oak Group',
    description: '', // ← this is critical for WhatsApp
    url: `${siteUrl}/signup`,
    siteName: 'Broad Oak Group',
    type: 'website',
    images: [
      {
        url: `${siteUrl}/og-image.png`,
        width: 1200,
        height: 630,
        alt: 'Broad Oak Group',
      },
    ],
  },

  twitter: {
    card: 'summary_large_image',
    title: 'Broad Oak Group',
    description: '',
    images: [`${siteUrl}/og-image.png`],
  },
};

export default function SignupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}