import { Suspense } from 'react';
import FileViewerClient from './viewer-client';

export default function FileViewerPage() {
  return (
    <Suspense fallback={<div className="p-6">Loading…</div>}>
      <FileViewerClient />
    </Suspense>
  );
}
