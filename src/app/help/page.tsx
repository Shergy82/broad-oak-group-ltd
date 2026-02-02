'use client';

import { Faq } from '@/components/landing/faq';

export default function HelpPage() {
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Help & Support</h1>
      <Faq />
    </div>
  );
}
