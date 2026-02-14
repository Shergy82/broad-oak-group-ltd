'use client';

import { useMemo, useState } from 'react';
import { format } from 'date-fns';

import { useAuth } from '@/hooks/use-auth';
import { acknowledgeAnnouncement } from '@/hooks/use-announcements-ack';
import { Button } from '@/components/ui/button';

export function PendingAnnouncementModal() {
  const { user, pendingAnnouncements } = useAuth();
  const [ackLoading, setAckLoading] = useState(false);

  const top = useMemo(
    () => pendingAnnouncements?.[0] ?? null,
    [pendingAnnouncements]
  );

  // If no signed-in user or no pending announcement, don't render
  if (!user || !top) return null;

  async function handleAcknowledge() {
    const u = user; // capture + narrow for TS
    const a = top;

    if (!u || !a) return;

    setAckLoading(true);
    try {
      await acknowledgeAnnouncement(a.id, u, u.displayName ?? 'Unknown');
      // After ack, the announcements page will refresh state; hard gate will lift once all are ack’d.
      window.location.href = '/announcements';
    } finally {
      setAckLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" />

      <div className="relative w-full max-w-lg rounded-xl border bg-background p-6 shadow-lg mx-4 space-y-4">
        <div className="space-y-1">
          <div className="text-sm text-muted-foreground">
            New announcement requires acknowledgement
          </div>

          <h2 className="text-xl font-semibold">{top.title || 'Announcement'}</h2>

          <div className="text-xs text-muted-foreground">
            Posted by {top.authorName || '—'}{' '}
            {top.createdAt?.toDate
              ? `on ${format(top.createdAt.toDate(), 'PPP')}`
              : ''}
          </div>
        </div>

        <div className="whitespace-pre-wrap text-sm max-h-[45vh] overflow-auto rounded-lg border p-3">
          {top.content || ''}
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button onClick={handleAcknowledge} disabled={ackLoading}>
            {ackLoading ? 'Acknowledging…' : 'Acknowledge'}
          </Button>
        </div>

        <div className="text-xs text-muted-foreground">
          You must acknowledge this before continuing to use the app.
        </div>
      </div>
    </div>
  );
}
