'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useUserProfile } from '@/hooks/use-user-profile';
import Dashboard from '@/components/dashboard';
import { Spinner } from '@/components/shared/spinner';
import { collection, onSnapshot, query, orderBy, where } from 'firebase/firestore';
import { db, functions } from '@/lib/firebase';
import { httpsCallable } from 'firebase/functions';
import type { Announcement, Shift } from '@/types';
import { UnreadAnnouncements } from '@/components/announcements/unread-announcements';
import { NewShiftsDialog } from '@/components/dashboard/new-shifts-dialog';

type Merchant = {
  name: string;
  rating?: number;
  address?: string;
  mapsUrl?: string;
};

export default function DashboardPage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const { userProfile, loading: isProfileLoading } = useUserProfile();
  const router = useRouter();

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [allShifts, setAllShifts] = useState<Shift[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [showAnnouncements, setShowAnnouncements] = useState(true);
  const [showNewShifts, setShowNewShifts] = useState(true);
  const [acknowledgedIds, setAcknowledgedIds] = useState<Set<string>>(new Set());

  // 🔥 AI assistant state
  const [searchInput, setSearchInput] = useState('');
  const [merchantResults, setMerchantResults] = useState<Merchant[]>([]);
  const [merchantLoading, setMerchantLoading] = useState(false);
  const [merchantError, setMerchantError] = useState<string | null>(null);

  /* =========================
     AUTH REDIRECT
  ========================= */

  useEffect(() => {
    if (!isAuthLoading && !user) {
      router.push('/login');
    }
  }, [user, isAuthLoading, router]);

  /* =========================
     LOAD ACKNOWLEDGED ANNOUNCEMENTS
  ========================= */

  useEffect(() => {
    if (!user) return;

    try {
      const stored = localStorage.getItem(`acknowledgedAnnouncements_${user.uid}`);
      if (stored) {
        setAcknowledgedIds(new Set(JSON.parse(stored)));
      }
    } catch {
      setAcknowledgedIds(new Set());
    }
  }, [user]);

  /* =========================
     FIRESTORE LISTENERS
  ========================= */

  useEffect(() => {
    if (!user) {
      setLoadingData(false);
      return;
    }

    setLoadingData(true);

    const announcementsQuery = query(
      collection(db, 'announcements'),
      orderBy('createdAt', 'desc')
    );

    const shiftsQuery = query(
      collection(db, 'shifts'),
      where('userId', '==', user.uid)
    );

    let announcementsLoaded = false;
    let shiftsLoaded = false;

    const checkLoaded = () => {
      if (announcementsLoaded && shiftsLoaded) {
        setLoadingData(false);
      }
    };

    const unsubAnnouncements = onSnapshot(
      announcementsQuery,
      (snapshot) => {
        setAnnouncements(
          snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Announcement))
        );
        announcementsLoaded = true;
        checkLoaded();
      },
      () => {
        announcementsLoaded = true;
        checkLoaded();
      }
    );

    const unsubShifts = onSnapshot(
      shiftsQuery,
      (snapshot) => {
        setAllShifts(
          snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Shift))
        );
        shiftsLoaded = true;
        checkLoaded();
      },
      () => {
        shiftsLoaded = true;
        checkLoaded();
      }
    );

    return () => {
      unsubAnnouncements();
      unsubShifts();
    };
  }, [user]);

  /* =========================
     MEMOS
  ========================= */

  const unreadAnnouncements = useMemo(() => {
    if (!user || loadingData) return [];
    return announcements.filter(a => !acknowledgedIds.has(a.id));
  }, [announcements, user, loadingData, acknowledgedIds]);

  const newShifts = useMemo(() => {
    if (!user || loadingData) return [];
    return allShifts.filter(shift => shift.status === 'pending-confirmation');
  }, [allShifts, user, loadingData]);

  const isLoading = isAuthLoading || isProfileLoading || loadingData;

  /* =========================
     AI MERCHANT SEARCH
  ========================= */

  const handleFindMerchant = async () => {
    if (!user || !searchInput.trim()) return;

    try {
      setMerchantLoading(true);
      setMerchantError(null);
      setMerchantResults([]);

      const findMerchants = httpsCallable(functions, 'aiMerchantFinder');

      const res: any = await findMerchants({
        message: searchInput,
        location: userProfile?.address || 'United Kingdom',
      });

      setMerchantResults(res.data.results || []);
    } catch (err) {
      console.error(err);
      setMerchantError('Unable to fetch merchants. Please try again.');
    } finally {
      setMerchantLoading(false);
    }
  };

  /* =========================
     LOADING + DIALOG PRIORITY
  ========================= */

  if (isLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (newShifts.length > 0 && showNewShifts) {
    return (
      <NewShiftsDialog
        shifts={newShifts}
        onClose={() => setShowNewShifts(false)}
      />
    );
  }

  if (unreadAnnouncements.length > 0 && showAnnouncements) {
    return (
      <UnreadAnnouncements
        announcements={unreadAnnouncements}
        user={user}
        onClose={() => setShowAnnouncements(false)}
      />
    );
  }

  /* =========================
     MAIN DASHBOARD
  ========================= */

  return (
    <div className="space-y-8 p-6">
      {/* AI TRADE ASSISTANT */}
      <div className="bg-white border rounded-xl p-6 shadow-sm space-y-4">
        <h2 className="text-lg font-semibold">AI Trade Assistant</h2>

        <div className="flex gap-2">
          <input
            type="text"
            placeholder="e.g. Find a roofer near Manchester"
            className="flex-1 border rounded px-3 py-2"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <button
            onClick={handleFindMerchant}
            disabled={merchantLoading}
            className="px-4 py-2 bg-black text-white rounded disabled:opacity-50"
          >
            Search
          </button>
        </div>

        {merchantLoading && <Spinner size="sm" />}

        {merchantError && (
          <div className="text-red-600 text-sm">{merchantError}</div>
        )}

        {merchantResults.length > 0 && (
          <div className="space-y-3">
            {merchantResults.map((m, i) => (
              <div key={i} className="border rounded p-4">
                <div className="font-semibold">{m.name}</div>
                <div>⭐ {m.rating || 'N/A'}</div>
                <div className="text-sm text-gray-600">{m.address}</div>
                {m.mapsUrl && (
                  <a
                    href={m.mapsUrl}
                    target="_blank"
                    className="text-blue-600 underline text-sm"
                  >
                    View on Maps
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <Dashboard userShifts={allShifts} loading={loadingData} />
    </div>
  );
}
