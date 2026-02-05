'use client';

import { useState, useEffect } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
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

    // Only fetch own profile for standard users
    const usersQuery = query(
      collection(db, 'users'),
      where('__name__', '==', user.uid)
    );

    const unsubscribe = onSnapshot(
      usersQuery,
      (snapshot) => {
        const fetchedUsers = snapshot.docs.map(doc => ({
          uid: doc.id,
          ...doc.data(),
        } as UserProfile));

        setUsers(fetchedUsers);
        setLoading(false);
      },
      (err) => {
        console.error('Error fetching users:', err);
        setError('Could not fetch user data.');
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user]);

  return { users, loading, error };
}
