'use client';

import { useEffect, useState, createContext } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  collection,
  getDocs,
  query,
  where,
  orderBy,
  type DocumentData,
} from 'firebase/firestore';
import { usePathname, useRouter } from 'next/navigation';

import { auth, isFirebaseConfigured, db } from '@/lib/firebase';
import { Spinner } from '@/components/shared/spinner';

export type PendingAnnouncement = {
  id: string;
  title?: string;
  content?: string;
  authorName?: string;
  createdAt?: any;
};

export const AuthContext = createContext<{
  user: User | null;
  isLoading: boolean;

  // Announcements gating + modal support
  pendingAnnouncements: PendingAnnouncement[];
  hasPendingAnnouncements: boolean;
}>({
  user: null,
  isLoading: true,
  pendingAnnouncements: [],
  hasPendingAnnouncements: false,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [checkingAcks, setCheckingAcks] = useState(true);

  const [pendingAnnouncements, setPendingAnnouncements] = useState<PendingAnnouncement[]>([]);
  const [hasPendingAnnouncements, setHasPendingAnnouncements] = useState(false);

  const router = useRouter();
  const pathname = usePathname();

  async function loadPendingAnnouncements(u: User) {
    // 1) Get all announcements (newest first)
    const annSnap = await getDocs(
      query(collection(db, 'announcements'), orderBy('createdAt', 'desc'))
    );

    if (annSnap.empty) return [];

    // 2) Get ONLY this user's acknowledgements (much cheaper than reading whole collection)
    const ackSnap = await getDocs(
      query(
        collection(db, 'announcementAcknowledgements'),
        where('userId', '==', u.uid)
      )
    );

    const acked = new Set<string>();
    ackSnap.docs.forEach((d) => {
      const data = d.data() as DocumentData;
      if (data?.announcementId) acked.add(String(data.announcementId));
    });

    // 3) Anything not in acked is pending
    const pending: PendingAnnouncement[] = [];
    for (const docSnap of annSnap.docs) {
      if (!acked.has(docSnap.id)) {
        const data = docSnap.data() as DocumentData;
        pending.push({
          id: docSnap.id,
          title: data?.title,
          content: data?.content,
          authorName: data?.authorName,
          createdAt: data?.createdAt,
        });
      }
    }

    return pending;
  }

  useEffect(() => {
    if (!isFirebaseConfigured || !auth) {
      setIsLoading(false);
      setCheckingAcks(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);

      if (!u) {
        setPendingAnnouncements([]);
        setHasPendingAnnouncements(false);
        setIsLoading(false);
        setCheckingAcks(false);
        return;
      }

      setCheckingAcks(true);

      try {
        const pending = await loadPendingAnnouncements(u);

        setPendingAnnouncements(pending);
        setHasPendingAnnouncements(pending.length > 0);

        // Hard gate: if pending, force announcements page
        if (pending.length > 0 && pathname !== '/announcements') {
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
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        pendingAnnouncements,
        hasPendingAnnouncements,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
