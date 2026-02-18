import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import JSZip from 'jszip';

/* =====================================================
   Bootstrap
===================================================== */

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();

/* =====================================================
   ENV
===================================================== */

const GEOCODING_KEY = process.env.GOOGLE_GEOCODING_KEY;

/* =====================================================
   HELPERS
===================================================== */

const assertAuthenticated = (uid?: string) => {
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }
};

const assertIsOwner = async (uid?: string) => {
  assertAuthenticated(uid);
  const snap = await db.collection('users').doc(uid!).get();
  if (snap.data()?.role !== 'owner') {
    throw new HttpsError('permission-denied', 'Owner role required');
  }
};

const assertAdminOrManager = async (uid: string) => {
  const snap = await db.collection('users').doc(uid).get();
  const role = snap.data()?.role;
  if (!['admin', 'owner', 'manager'].includes(role)) {
    throw new HttpsError('permission-denied', 'Insufficient permissions');
  }
};

/* =====================================================
   NOTIFICATIONS
===================================================== */

export const getNotificationStatus = onCall(
  { region: 'europe-west2' },
  async (req) => {
    assertAuthenticated(req.auth?.uid);
    const doc = await db.collection('users').doc(req.auth!.uid).get();
    return { enabled: doc.data()?.notificationsEnabled ?? false };
  }
);

export const setNotificationStatus = onCall(
  { region: 'europe-west2' },
  async (req) => {
    assertAuthenticated(req.auth?.uid);

    const uid = req.auth!.uid;
    const { enabled, subscription } = req.data ?? {};

    if (typeof enabled !== 'boolean') {
      throw new HttpsError('invalid-argument', 'enabled must be boolean');
    }

    await db.collection('users').doc(uid).set(
      { notificationsEnabled: enabled },
      { merge: true }
    );

    if (enabled && subscription) {
      await db
        .collection('users')
        .doc(uid)
        .collection('pushSubscriptions')
        .doc('browser')
        .set(subscription, { merge: true });
    }

    return { success: true };
  }
);

/* =====================================================
   USER MANAGEMENT
===================================================== */

export const setUserStatus = onCall(
  { region: 'europe-west2' },
  async (req) => {
    await assertIsOwner(req.auth?.uid);

    const { uid, disabled, newStatus } = req.data ?? {};
    if (
      typeof uid !== 'string' ||
      typeof disabled !== 'boolean' ||
      !['active', 'suspended'].includes(newStatus)
    ) {
      throw new HttpsError('invalid-argument', 'Invalid input');
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

    const { uid } = req.data ?? {};
    if (typeof uid !== 'string') {
      throw new HttpsError('invalid-argument', 'uid required');
    }

    await admin.auth().deleteUser(uid);
    await db.collection('users').doc(uid).delete();

    return { success: true };
  }
);

/* =====================================================
   PROJECT & FILE MANAGEMENT
===================================================== */

export const deleteProjectAndFiles = onCall(
  { region: 'europe-west2', timeoutSeconds: 540, memory: '1GiB' },
  async (req) => {
    assertAuthenticated(req.auth?.uid);
    await assertAdminOrManager(req.auth!.uid);

    const { projectId } = req.data as { projectId: string };
    if (!projectId) {
      throw new HttpsError('invalid-argument', 'projectId is required');
    }

    const bucket = admin.storage().bucket();
    const projectRef = db.collection('projects').doc(projectId);

    // Gracefully handle storage deletion errors
    await bucket.deleteFiles({ prefix: `project_files/${projectId}/` }).catch(e => {
        console.warn(`Could not clean up storage for project ${projectId}, but proceeding with Firestore deletion.`, e);
    });

    const filesSnap = await projectRef.collection('files').get();
    if (!filesSnap.empty) {
        const batch = db.batch();
        filesSnap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
    }

    await projectRef.delete();

    return { success: true };
  }
);

/* =====================================================
   PROJECT FILE DELETE (CALLABLE)
===================================================== */

export const deleteProjectFile = onCall(
  { region: 'europe-west2' },
  async (req) => {
    assertAuthenticated(req.auth?.uid);
    const uid = req.auth!.uid;

    const { projectId, fileId } = req.data ?? {};
    if (!projectId || !fileId) {
      throw new HttpsError('invalid-argument', 'projectId and fileId required');
    }

    const userSnap = await db.collection('users').doc(uid).get();
    const role = userSnap.data()?.role;

    const fileRef = db
      .collection('projects')
      .doc(projectId)
      .collection('files')
      .doc(fileId);

    const fileDoc = await fileRef.get();
    if (!fileDoc.exists) return { success: true };

    const data = fileDoc.data()!;
    if (
      uid !== data.uploaderId &&
      !['admin', 'owner', 'manager'].includes(role)
    ) {
      throw new HttpsError('permission-denied', 'Not allowed');
    }

    if (data.fullPath) {
      await admin.storage().bucket().file(data.fullPath).delete().catch(() => {});
    }

    await fileRef.delete();
    return { success: true };
  }
);

/* =====================================================
   ZIP PROJECT FILES
===================================================== */

export const zipProjectFiles = onCall(
  { region: 'europe-west2', timeoutSeconds: 300, memory: '1GiB' },
  async (req) => {
    assertAuthenticated(req.auth?.uid);

    const { projectId } = req.data ?? {};
    if (!projectId) {
      throw new HttpsError('invalid-argument', 'projectId required');
    }

    const projectDoc = await db.collection('projects').doc(projectId).get();
    if (!projectDoc.exists) {
      throw new HttpsError('not-found', 'Project not found');
    }

    const filesSnap = await projectDoc.ref.collection('files').get();
    if (filesSnap.empty) {
      throw new HttpsError('not-found', 'No files');
    }

    const zip = new JSZip();
    const bucket = admin.storage().bucket();

    await Promise.all(
      filesSnap.docs.map(async (doc) => {
        const data = doc.data();
        if (data.fullPath) {
          const [buf] = await bucket.file(data.fullPath).download();
          zip.file(data.name, buf);
        }
      })
    );

    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const zipPath = `archives/${projectId}/${Date.now()}.zip`;

    const file = bucket.file(zipPath);
    await file.save(buffer, { contentType: 'application/zip' });

    const [downloadUrl] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 15 * 60 * 1000,
    });

    return { downloadUrl };
  }
);

/* =====================================================
   SHIFTS
===================================================== */

export const deleteAllShifts = onCall(
  { region: 'europe-west2' },
  async (req) => {
    await assertIsOwner(req.auth?.uid);

    const snap = await db.collection('shifts').get();
    if (snap.empty) return { success: true };

    const batch = db.batch();
    snap.docs.forEach((d) => {
      const status = d.data().status;
      if (!['completed', 'incomplete', 'rejected'].includes(status)) {
        batch.delete(d.ref);
      }
    });

    await batch.commit();
    return { success: true };
  }
);

/* =====================================================
   RE-GEOCODE SHIFTS
===================================================== */

export const reGeocodeAllShifts = onCall(
  { region: 'europe-west2', timeoutSeconds: 540, memory: '1GiB' },
  async (req) => {
    await assertIsOwner(req.auth?.uid);

    if (!GEOCODING_KEY) {
      throw new HttpsError('failed-precondition', 'Missing GEOCODING_KEY');
    }

    const snap = await db.collection('shifts').get();
    let updated = 0;

    for (const doc of snap.docs) {
      const addr = doc.data().address;
      if (!addr) continue;

      const url =
        `https://maps.googleapis.com/maps/api/geocode/json` +
        `?address=${encodeURIComponent(addr + ', UK')}` +
        `&key=${GEOCODING_KEY}`;

      const res = await fetch(url);
      const json = (await res.json()) as {
        status: string;
        results?: Array<{
          geometry: { location: { lat: number; lng: number } };
        }>;
      };

      if (json.status === 'OK' && json.results?.length) {
        await doc.ref.update({ location: json.results[0].geometry.location });
        updated++;
      }
    }

    return { updated };
  }
);
