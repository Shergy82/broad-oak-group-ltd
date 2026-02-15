import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import fetch from 'node-fetch';

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();

/* =====================================================
   ENV
===================================================== */

const GEOCODING_KEY =
  process.env.GOOGLE_GEOCODING_KEY ||
  require('firebase-functions').config().google.geocoding_key;

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

    if (typeof req.data?.enabled !== 'boolean') {
      throw new HttpsError('invalid-argument', 'enabled must be boolean');
    }

    await db
      .collection('users')
      .doc(req.auth.uid)
      .set({ notificationsEnabled: req.data.enabled }, { merge: true });

    return { success: true };
  }
);

/* =====================================================
   USER MANAGEMENT (OWNER ONLY)
===================================================== */

const assertIsOwner = async (uid?: string) => {
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  const snap = await db.collection('users').doc(uid).get();
  if (snap.data()?.role !== 'owner') {
    throw new HttpsError('permission-denied', 'Owner role required');
  }
};

export const setUserStatus = onCall(
  { region: 'europe-west2' },
  async (req) => {
    await assertIsOwner(req.auth?.uid);

    const { uid, disabled, newStatus } = req.data;

    if (
      typeof uid !== 'string' ||
      typeof disabled !== 'boolean' ||
      !['active', 'suspended'].includes(newStatus)
    ) {
      throw new HttpsError(
        'invalid-argument',
        'uid, disabled, and valid newStatus are required'
      );
    }

    await admin.auth().updateUser(uid, { disabled });
    await db.collection('users').doc(uid).update({ status: newStatus });

    return { success: true };
  }
);

export const deleteUser = onCall(
  { region: 'europe-west2' },
  async (req) => {
    await assertIsOwner(req.auth?.uid);

    const { uid } = req.data;
    if (typeof uid !== 'string') {
      throw new HttpsError('invalid-argument', 'uid is required');
    }

    await admin.auth().deleteUser(uid);
    await db.collection('users').doc(uid).delete();

    return { success: true };
  }
);

/* =====================================================
   ONE-OFF: RE-GEOCODE ALL SHIFTS
===================================================== */

export const reGeocodeAllShifts = onCall(
  {
    region: 'europe-west2',
    timeoutSeconds: 540,
    memory: '1GiB',
  },
  async (req) => {
    await assertIsOwner(req.auth?.uid);

    if (!GEOCODING_KEY) {
      throw new HttpsError(
        'failed-precondition',
        'Missing Google Geocoding API key'
      );
    }

    const snap = await db.collection('shifts').get();

    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (const doc of snap.docs) {
      const data = doc.data();

      if (!data?.address) {
        skipped++;
        continue;
      }

      const address = encodeURIComponent(`${data.address}, UK`);
      const url =
        `https://maps.googleapis.com/maps/api/geocode/json?` +
        `address=${address}&key=${GEOCODING_KEY}`;

      try {
        const res = await fetch(url);
        const json: any = await res.json();

        if (json.status !== 'OK' || !json.results?.length) {
          failed++;
          continue;
        }

        const result = json.results[0];
        const { lat, lng } = result.geometry.location;
        const accuracy = result.geometry.location_type;

        await doc.ref.update({
          location: {
            lat,
            lng,
            accuracy, // ROOFTOP | RANGE_INTERPOLATED | POSTAL_CODE
          },
        });

        updated++;
      } catch (err) {
        failed++;
      }
    }

    return { updated, skipped, failed };
  }
);
