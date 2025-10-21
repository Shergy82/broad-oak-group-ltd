
'use client';

import { useState, useEffect } from 'react';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { UserProfile } from '@/types';

export function useAllUsers() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!db) {
      setLoading(false);
      setError("Firebase is not configured.");
      return;
    }

    const usersQuery = query(collection(db, 'users'));
    const unsubscribe = onSnapshot(usersQuery, (snapshot) => {
      const fetchedUsers = snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile));
      setUsers(fetchedUsers);
      setLoading(false);
    }, (err) => {
      console.error("Error fetching all users:", err);
      setError("Could not fetch user data.");
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  return { users, loading, error };
}
