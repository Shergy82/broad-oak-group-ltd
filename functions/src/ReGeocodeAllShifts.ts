import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// Environment variable (set via firebase.json or env file)
const GEOCODING_KEY = process.env.GOOGLE_GEOCODING_KEY;

export const reGeocodeAllShifts = onCall(
  {
    region: 'europe-west2',
    timeoutSeconds: 540,
    memory: '1GiB',
  },
  async (req) => {
    /* =========================
       AUTH / PERMISSIONS
    ========================= */

    if (!req.auth) {
      throw new HttpsError('unauthenticated', 'Login required');
    }

    const userSnap = await db.collection('users').doc(req.auth.uid).get();
    if (userSnap.data()?.role !== 'owner') {
      throw new HttpsError('permission-denied', 'Owner only');
    }

    if (!GEOCODING_KEY) {
      throw new HttpsError(
        'failed-precondition',
        'Missing GOOGLE_GEOCODING_KEY'
      );
    }

    /* =========================
       PROCESS SHIFTS
    ========================= */

    const snap = await db.collection('shifts').get();

    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (const doc of snap.docs) {
      const data = doc.data();

      // Skip if no address
      if (!data?.address) {
        skipped++;
        continue;
      }

      // Skip if already has coordinates
      if (data.location?.lat && data.location?.lng) {
        skipped++;
        continue;
      }

      const address = encodeURIComponent(`${data.address}, UK`);
      const url =
        `https://maps.googleapis.com/maps/api/geocode/json` +
        `?address=${address}&key=${GEOCODING_KEY}`;

      try {
        const res = await fetch(url);
        const json = (await res.json()) as any;

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
        console.error('Geocode failed for shift', doc.id, err);
        failed++;
      }
    }

    return { updated, skipped, failed };
  }
);
