import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  collection,
  getDocs,
  query,
  where,
} from 'firebase/firestore';

import { db } from '@/lib/firebase';

// Save acknowledgement
export async function acknowledgeAnnouncement(
  announcementId: string,
  user: any,
  name: string
) {
  const id = `${announcementId}_${user.uid}`;

  await setDoc(doc(db, 'announcementAcknowledgements', id), {
    announcementId,
    userId: user.uid,
    name,
    acknowledgedAt: serverTimestamp(),
  });
}

// Check if user acknowledged
export async function hasAcknowledged(
  announcementId: string,
  user: any
) {
  const id = `${announcementId}_${user.uid}`;

  return (await getDoc(
    doc(db, 'announcementAcknowledgements', id)
  )).exists();
}

// ADMIN: Get all acknowledgements for one announcement
export async function getAcknowledgementsForAnnouncement(
  announcementId: string
) {
  const q = query(
    collection(db, 'announcementAcknowledgements'),
    where('announcementId', '==', announcementId)
  );

  const snap = await getDocs(q);

  return snap.docs.map((d) => ({
    id: d.id,
    ...d.data(),
  }));
}
