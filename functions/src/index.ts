import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();

/* =====================================================
   NOTIFICATION STATUS (REQUIRED BY FRONTEND)
===================================================== */

export const getNotificationStatus = onCall(
  { region: 'europe-west2' },
  async (req) => {
    if (!req.auth) {
      throw new HttpsError('unauthenticated', 'Login required');
    }

    const doc = await db.collection('users').doc(req.auth.uid).get();
    return { enabled: doc.data()?.notificationsEnabled ?? false };
  }
);

export const setNotificationStatus = onCall(
  { region: 'europe-west2' },
  async (req) => {
    if (!req.auth) {
      throw new HttpsError('unauthenticated', 'Login required');
    }

    const enabled = req.data?.enabled === true;
    if (typeof enabled !== 'boolean') {
      throw new HttpsError('invalid-argument', 'enabled must be boolean');
    }

    await db
      .collection('users')
      .doc(req.auth.uid)
      .set({ notificationsEnabled: enabled }, { merge: true });

    return { success: true };
  }
);
