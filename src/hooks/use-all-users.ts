'use client';

import { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/use-auth';
import type { UserProfile } from '@/types';

export function useAllUsers() {
  const { user } = useAuth();

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!db || !user) {
      setLoading(false);
      return;
    }

    const userRef = doc(db, 'users', user.uid);

    const unsubscribe = onSnapshot(
      userRef,
      (snap) => {
        if (snap.exists()) {
          setUsers([{ uid: snap.id, ...snap.data() } as UserProfile]);
        } else {
          setUsers([]);
        }
        setLoading(false);
      },
      (err) => {
        console.error('Error fetching user:', err);
        setError('Could not fetch user data.');
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user]);

  return { users, loading, error };
}
