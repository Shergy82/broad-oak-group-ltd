'use client';

import { useEffect, useState, createContext } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { collection, getDocs, query } from 'firebase/firestore';
import { usePathname, useRouter } from 'next/navigation';

import { auth, isFirebaseConfigured, db } from '@/lib/firebase';
import { Spinner } from '@/components/shared/spinner';

export const AuthContext = createContext<{
  user: User | null;
  isLoading: boolean;
}>({
  user: null,
  isLoading: true,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [checkingAcks, setCheckingAcks] = useState(true);

  const router = useRouter();
  const pathname = usePathname();

  // Check if user has unacknowledged announcements
  async function hasPendingAnnouncements(u: User) {
    // Get all announcements
    const annSnap = await getDocs(
      query(collection(db, 'announcements'))
    );

    if (annSnap.empty) return false;

    // Get all this user's acknowledgements
    const ackSnap = await getDocs(
      query(collection(db, 'announcementAcknowledgements'))
    );

    const acked = new Set<string>();

    ackSnap.docs.forEach((d) => {
      const data = d.data();
      if (data.userId === u.uid) {
        acked.add(data.announcementId);
      }
    });

    // Check if any announcement is missing
    for (const doc of annSnap.docs) {
      if (!acked.has(doc.id)) return true;
    }

    return false;
  }

  useEffect(() => {
    if (!isFirebaseConfigured || !auth) {
      setIsLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);

      if (!u) {
        setIsLoading(false);
        setCheckingAcks(false);
        return;
      }

      setCheckingAcks(true);

      try {
        const pending = await hasPendingAnnouncements(u);

        // Force user to announcements page
        if (pending && pathname !== '/announcements') {
          router.replace('/announcements');
        }
      } finally {
        setCheckingAcks(false);
        setIsLoading(false);
      }
    });

    return () => unsubscribe();
  }, [router, pathname]);

  if (isLoading || checkingAcks) {
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
