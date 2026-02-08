'use client';

import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';

export default function FileViewerPage() {
  const sp = useSearchParams();
  const url = sp.get('url') ?? '';
  const name = sp.get('name') ?? 'File';

  const kind = useMemo(() => {
    const lower = name.toLowerCase();
    if (lower.endsWith('.pdf')) return 'pdf';
    if (/\.(png|jpe?g|gif|webp)$/i.test(lower)) return 'image';
    return 'other';
  }, [name]);

  if (!url) {
    return (
      <div className="p-6">
        <h1 className="text-lg font-semibold">Missing file URL</h1>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="p-3 border-b">
        <div className="text-sm font-medium truncate">{name}</div>
      </div>

      <div className="p-3">
        {kind === 'image' ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={name} className="w-full h-auto rounded" />
        ) : kind === 'pdf' ? (
          <iframe src={url} className="w-full h-[85vh] rounded" />
        ) : (
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              Preview not available for this file type.
            </div>
            <a
              className="underline"
              href={url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open file
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
