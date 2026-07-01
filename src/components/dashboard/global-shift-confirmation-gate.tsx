'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { startOfToday, isBefore } from 'date-fns';

import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { getCorrectedLocalDate } from '@/lib/utils';
import type { Shift } from '@/types';
import { NewShiftsDialog } from '@/components/dashboard/new-shifts-dialog';

export function GlobalShiftConfirmationGate() {
  const { user, isLoading } = useAuth();
  const { toast } = useToast();

  const [allUserShifts, setAllUserShifts] = useState<Shift[]>([]);

  useEffect(() => {
    if (isLoading) return;

    if (!user?.uid) {
      setAllUserShifts([]);
      return;
    }

    const shiftsQuery = query(
      collection(db, 'shifts'),
      where('userId', '==', user.uid)
    );

    const unsubscribe = onSnapshot(
      shiftsQuery,
      snapshot => {
        const fetchedShifts = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        })) as Shift[];

        setAllUserShifts(fetchedShifts);
      },
      error => {
        console.error('Global shift confirmation query failed:', error);
        toast({
          title: 'Error loading shift confirmations',
          description: 'Could not check whether you have new shifts awaiting confirmation.',
          variant: 'destructive',
          duration: 10000,
        });
      }
    );

    return () => unsubscribe();
  }, [user?.uid, isLoading, toast]);

  const pendingShifts = useMemo(() => {
    const today = startOfToday();

    return allUserShifts.filter(shift => {
      if (shift.status !== 'pending-confirmation' && shift.status !== 'pending') {
        return false;
      }

      const shiftDate = getCorrectedLocalDate(shift.date);

      return !isBefore(shiftDate, today);
    });
  }, [allUserShifts]);

  if (isLoading || !user || pendingShifts.length === 0) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[9999] bg-background/80">
      <NewShiftsDialog
        shifts={pendingShifts}
        onClose={() => {
          // Deliberately blocked.
          // The gate only disappears when every pending shift has been accepted or rejected.
        }}
      />
    </div>
  );
}
