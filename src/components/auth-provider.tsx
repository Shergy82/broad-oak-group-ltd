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
  doc,
  getDoc,
} from 'firebase/firestore';
import { usePathname, useRouter } from 'next/navigation';

import { auth, isFirebaseConfigured, db } from '@/lib/firebase';
import { Spinner } from '@/components/shared/spinner';
import type { UserProfile } from '@/types';

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

  async function loadPendingAnnouncements(u: User, profile: UserProfile | null) {
    if (!db || !profile) return [];

    const isOwner = profile.role === 'owner';
    let annDocs: DocumentData[] = [];

    try {
      if (isOwner) {
        const annSnap = await getDocs(
          query(collection(db, 'announcements'), orderBy('createdAt', 'desc'))
        );
        annDocs = annSnap.docs;
      } else {
        const userDepartment = profile.department;
        const queries = [
          getDocs(query(collection(db, 'announcements'), where('department', '==', null))),
        ];

        if (userDepartment) {
          queries.push(
            getDocs(
              query(
                collection(db, 'announcements'),
                where('department', '==', userDepartment)
              )
            )
          );
        }

        const snapshots = await Promise.all(queries);
        const docs = snapshots.flatMap((snap) => snap.docs);
        const uniqueDocsMap = new Map<string, DocumentData>();
        docs.forEach((doc) => uniqueDocsMap.set(doc.id, doc));

        annDocs = Array.from(uniqueDocsMap.values());
        annDocs.sort(
          (a, b) =>
            (b.data().createdAt?.toMillis() || 0) -
            (a.data().createdAt?.toMillis() || 0)
        );
      }
    } catch (e) {
      console.error('Failed to query announcements:', e);
      return []; // Return empty on error to not block UI
    }

    if (annDocs.length === 0) return [];

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

    const pending: PendingAnnouncement[] = [];
    for (const docSnap of annDocs) {
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
    if (!isFirebaseConfigured || !auth || !db) {
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
        const userDocRef = doc(db, 'users', u.uid);
        const userDocSnap = await getDoc(userDocRef);
        const userProfile = userDocSnap.exists()
          ? (userDocSnap.data() as UserProfile)
          : null;

        const pending = await loadPendingAnnouncements(u, userProfile);

        setPendingAnnouncements(pending);
        setHasPendingAnnouncements(pending.length > 0);
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
