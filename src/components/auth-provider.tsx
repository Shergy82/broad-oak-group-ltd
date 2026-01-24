'use client';

import { useEffect, useState, createContext } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth, db, isFirebaseConfigured } from '@/lib/firebase';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { Spinner } from '@/components/shared/spinner';

export const AuthContext = createContext<{ user: User | null; isLoading: boolean }>(
  {
    user: null,
    isLoading: true,
  }
);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!isFirebaseConfigured || !auth || !db) {
      setIsLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUser(user);

      if (user) {
        // ✅ Ensure Firestore user doc ID matches Firebase Auth UID
        await setDoc(
          doc(db, 'users', user.uid),
          {
            email: user.email ?? '',
            name: user.displayName ?? '',
            status: 'active',
            createdAt: serverTimestamp(),
          },
          { merge: true }
        );
      }

      setIsLoading(false);
    });

    return () => unsubscribe();
  }, []);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ user, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}
