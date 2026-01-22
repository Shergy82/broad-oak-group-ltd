'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

type Shift = {
  address: string;
  contract: string;
  date: any;
  task: string;
  type: string;
  status: string;
  manager: string;
};

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

  return (
    <div style={{ padding: 24 }}>
      <h1>Shift</h1>

      <p><strong>Address:</strong> {shift.address}</p>
      <p><strong>Task:</strong> {shift.task}</p>
      <p><strong>Type:</strong> {shift.type}</p>
      <p><strong>Status:</strong> {shift.status}</p>
      <p><strong>Manager:</strong> {shift.manager}</p>
    </div>
  );
}
