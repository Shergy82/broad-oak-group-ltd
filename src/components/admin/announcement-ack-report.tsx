'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';

import { getAcknowledgementsForAnnouncement } from '@/hooks/use-announcements-ack';
import { Button } from '@/components/ui/button';

type AckRow = {
  id: string;
  announcementId: string;
  userId: string;
  name?: string;
  acknowledgedAt?: any;
};

export function AnnouncementAckReport({ announcementId }: { announcementId: string }) {
  const [rows, setRows] = useState<AckRow[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const data = (await getAcknowledgementsForAnnouncement(announcementId)) as AckRow[];
        setRows(data);
      } finally {
        setLoading(false);
      }
    }

    if (open) load();
  }, [open, announcementId]);

  return (
    <div className="space-y-2">
      <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
        {open ? 'Hide acknowledgements' : 'View acknowledgements'}
      </Button>

      {open && (
        <div className="rounded-lg border p-3 space-y-2 text-sm">
          {loading ? (
            <div className="text-muted-foreground">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="text-muted-foreground">No acknowledgements yet.</div>
          ) : (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">
                Total: {rows.length}
              </div>

              <div className="space-y-1">
                {rows
                  .sort((a, b) => {
                    const am = a.acknowledgedAt?.toMillis?.() ?? 0;
                    const bm = b.acknowledgedAt?.toMillis?.() ?? 0;
                    return bm - am;
                  })
                  .map((r) => (
                    <div key={r.id} className="flex items-center justify-between gap-3">
                    <div className="truncate">
                     <span className="font-medium">{r.name || 'Unknown'}</span>
                    </div>
                
                      <div className="text-xs text-muted-foreground">
                        {r.acknowledgedAt?.toDate
                          ? format(r.acknowledgedAt.toDate(), 'PP p')
                          : ''}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
