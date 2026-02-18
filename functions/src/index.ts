import * as admin from 'firebase-admin';
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import type { Request, Response } from 'express';
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
   FILE SERVING (HTTP)
===================================================== */
export const serveFile = onRequest({ region: "europe-west2", cors: true }, async (req, res) => {
    const path = req.query.path as string;
    const download = req.query.download === "1";

    if (!path) {
        res.status(400).send("Missing path");
        return;
    }

    const bucket = admin.storage().bucket();
    const file = bucket.file(path);

    try {
        const [exists] = await file.exists();
        if (!exists) {
            res.status(404).send("Not found");
            return;
        }

        const [meta] = await file.getMetadata();
        res.setHeader("Content-Type", meta.contentType || "application/octet-stream");

        if (download) {
            res.setHeader(
                "Content-Disposition",
                `attachment; filename="${path.split("/").pop()}"`
            );
        }

        file.createReadStream().pipe(res);
    } catch (e) {
        console.error("Error serving file:", e);
        res.status(500).send("Internal server error");
    }
});


/* =====================================================
   PROJECT & FILE MANAGEMENT (HTTP — NOT CALLABLE)
===================================================== */

export const deleteProjectAndFiles = onRequest(
  {
    region: 'europe-west2',
    timeoutSeconds: 540,
    memory: '1GiB',
    cors: true,
  },
  async (req: Request, res: Response) => {
    try {
      if (req.method === 'OPTIONS') {
        res.set('Access-Control-Allow-Origin', req.headers.origin || '*');
        res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.status(204).send('');
        return;
      }

      res.set('Access-Control-Allow-Origin', req.headers.origin || '*');

      if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
      }

      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const idToken = authHeader.replace('Bearer ', '');
      const decoded = await admin.auth().verifyIdToken(idToken);
      await assertAdminOrManager(decoded.uid);

      const { projectId } = req.body ?? {};
      if (!projectId) {
        res.status(400).json({ error: 'projectId is required' });
        return;
      }

      const bucket = admin.storage().bucket();
      const projectRef = db.collection('projects').doc(projectId);

      await bucket.deleteFiles({ prefix: `project_files/${projectId}/` });

      const filesSnap = await projectRef.collection('files').get();
      if (!filesSnap.empty) {
        const batch = db.batch();
        filesSnap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }

      await projectRef.delete();

      res.json({ success: true });
    } catch (err: any) {
        console.error('deleteProjectAndFiles failed', err);
        if (err instanceof HttpsError) {
          res.status(403).json({ error: err.message });
        } else {
          res.status(500).json({ error: 'Internal server error' });
        }
    }
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
