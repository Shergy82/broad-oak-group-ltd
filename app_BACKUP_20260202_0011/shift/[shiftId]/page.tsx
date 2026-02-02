'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

type Shift = {
  address: string;
  contract: string;
  date: any; // Firestore Timestamp
  task: string;
  type: string;
  status: string;
  manager: string;
};

function isShiftBeforeToday(shiftDateValue: any): boolean {
  if (!shiftDateValue) return false;

  // Firestore Timestamp -> Date
  const rawDate: Date =
    typeof shiftDateValue?.toDate === 'function'
      ? shiftDateValue.toDate()
      : new Date(shiftDateValue);

  // Compare by "day", using the UTC Y/M/D from Firestore timestamp, but as a local date-only
  const shiftDay = new Date(rawDate.getUTCFullYear(), rawDate.getUTCMonth(), rawDate.getUTCDate());
  shiftDay.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return shiftDay.getTime() < today.getTime();
}

function getDisplayStatus(status: string | undefined, shiftDateValue: any): string {
  const s = (status || '').toLowerCase();

  // Final/historical statuses must NEVER be shown as expired
  const finalStatuses = new Set(['completed', 'incomplete', 'rejected']);
  if (finalStatuses.has(s)) return status || '';

  // Only pending/active shifts become "expired" if they are before today
  const isPast = isShiftBeforeToday(shiftDateValue);
  if (isPast) return 'expired';

  return status || '';
}

export default function ShiftPage() {
  const { shiftId } = useParams<{ shiftId: string }>();
  const [shift, setShift] = useState<Shift | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadShift() {
      if (!shiftId) return;

      const ref = doc(db, 'shifts', shiftId);
      const snap = await getDoc(ref);

      if (snap.exists()) {
        setShift(snap.data() as Shift);
      }

      setLoading(false);
    }

    loadShift();
  }, [shiftId]);

  if (loading) return <div>Loading shift…</div>;
  if (!shift) return <div>Shift not found</div>;

  const statusLabel = getDisplayStatus(shift.status, shift.date);

  return (
    <div style={{ padding: 24 }}>
      <h1>Shift</h1>

      <p><strong>Address:</strong> {shift.address}</p>
      <p><strong>Task:</strong> {shift.task}</p>
      <p><strong>Type:</strong> {shift.type}</p>
      <p><strong>Status:</strong> {statusLabel}</p>
      <p><strong>Manager:</strong> {shift.manager}</p>
    </div>
  );
}
