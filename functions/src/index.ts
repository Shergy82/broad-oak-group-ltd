
import * as admin from 'firebase-admin';
import * as functions from "firebase-functions";
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import type { Request, Response } from 'express';
import JSZip from 'jszip';
import { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";
import * as webPush from "web-push";


/* =====================================================
   Bootstrap
===================================================== */

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();


/* =====================================================
   VAPID/WebPush Configuration
===================================================== */

const WEBPUSH_PUBLIC_KEY = process.env.WEBPUSH_PUBLIC_KEY;
const WEBPUSH_PRIVATE_KEY = process.env.WEBPUSH_PRIVATE_KEY;

if (WEBPUSH_PUBLIC_KEY && WEBPUSH_PRIVATE_KEY) {
  try {
    webPush.setVapidDetails(
      "mailto:example@yourdomain.org",
      WEBPUSH_PUBLIC_KEY,
      WEBPUSH_PRIVATE_KEY
    );
  } catch (error) {
    logger.error("Failed to set VAPID details for web-push.", error);
  }
} else {
  logger.warn("WEBPUSH_PUBLIC_KEY and/or WEBPUSH_PRIVATE_KEY environment variables are not set. Push notifications will not work.");
}


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

function formatDateUK(d: Date): string {
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const yyyy = String(d.getUTCFullYear());
    return `${dd}/${mm}/${yyyy}`;
}

function isShiftInPast(shiftDate: Date): boolean {
    const now = new Date();
    const startOfTodayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const shiftDayUtc = new Date(Date.UTC(shiftDate.getUTCFullYear(), shiftDate.getUTCMonth(), shiftDate.getUTCDate()));
    return shiftDayUtc < startOfTodayUtc;
}

function absoluteLink(pathOrUrl: string): string {
    if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
      return pathOrUrl;
    }
    return pathOrUrl;
}

function pendingGateUrl(): string {
    return "/dashboard?gate=pending";
}

/* =====================================================
   NOTIFICATIONS
===================================================== */

async function sendShiftNotification(userId: string, title: string, body: string, urlPath: string, data: Record<string, any> = {}) {
  if (!userId) {
      logger.log("No userId provided, skipping notification.");
      return;
  }
  
  if (!WEBPUSH_PUBLIC_KEY || !WEBPUSH_PRIVATE_KEY) {
      logger.warn("VAPID keys not configured. Cannot send push notification.");
      return;
  }

  const userDoc = await db.collection("users").doc(userId).get();
  if (userDoc.exists && userDoc.data()?.notificationsEnabled === false) {
      logger.log("User has notifications disabled; skipping send.", { userId });
      return;
  }

  const subscriptionsSnapshot = await db.collection("users").doc(userId).collection("pushSubscriptions").get();
  if (subscriptionsSnapshot.empty) {
      logger.log(`No push subscriptions found for user ${userId}.`);
      return;
  }

  const payload = JSON.stringify({
    title,
    body,
    data: {
        url: absoluteLink(urlPath),
        ...data,
    }
  });

  const shiftIdForLog = data.shiftId || 'unknown';

  const results = await Promise.all(
    subscriptionsSnapshot.docs.map(async (subDoc) => {
      const subscription = subDoc.data();

      try {
        await webPush.sendNotification(subscription, payload);
        logger.log(`Push sent OK for user ${userId}, subDoc=${subDoc.id}`);
        return { ok: true, id: subDoc.id };
      } catch (error: any) {
        const code = error?.statusCode;
        logger.error(
          `Push send FAILED for user ${userId}, subDoc=${subDoc.id}, status=${code}`,
          error
        );

        if (code === 410 || code === 404) {
          logger.log(`Deleting invalid subscription for user ${userId}, subDoc=${subDoc.id}`);
          await subDoc.ref.delete().catch(() => {});
          return { ok: false, id: subDoc.id, deleted: true, status: code };
        }

        return { ok: false, id: subDoc.id, status: code };
      }
    })
  );

  const okCount = results.filter((r) => r.ok).length;
  const failCount = results.length - okCount;
  logger.log(`Finished sending notifications for shift ${shiftIdForLog}. ok=${okCount} fail=${failCount}`);
}

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
      throw new HttpsError('failed-precondition', 'Missing GOOGLE_GEOCODING_KEY');
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

/* =====================================================
   FIRESTORE TRIGGERS
===================================================== */

const europeWest2 = "europe-west2";

export const onShiftCreated = onDocumentCreated({ document: "shifts/{shiftId}", region: europeWest2 }, async (event) => {
    const shift = event.data?.data();
    if (!shift) return;

    const userId = shift.userId;
    if (!userId) {
      logger.log("Shift created without userId; no notify", {
        shiftId: event.params.shiftId,
      });
      return;
    }

    const shiftDate = shift.date?.toDate ? shift.date.toDate() : null;
    if (!shiftDate) return;

    if (isShiftInPast(shiftDate)) {
      logger.log("Shift created in past; no notify", {
        shiftId: event.params.shiftId,
      });
      return;
    }

    const shiftId = event.params.shiftId;
    await sendShiftNotification(
      userId,
      "New shift added",
      `A new shift was added for ${formatDateUK(shiftDate)}`,
      pendingGateUrl(),
      { shiftId, gate: "pending", event: "created" }
    );
});

export const onShiftUpdated = onDocumentUpdated({ document: "shifts/{shiftId}", region: europeWest2 }, async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;

    const shiftId = event.params.shiftId;
    const userId = after.userId;

    // FIRST: Check for self-updates that should be silenced.
    // A user updated their own shift status (e.g., from 'on-site' to 'incomplete').
    if (after.updatedByUid && after.updatedByUid === userId) {
        const statusBefore = String(before.status || "").toLowerCase();
        const statusAfter = String(after.status || "").toLowerCase();

        const isIncompleteUpdate = statusAfter === 'incomplete' && statusBefore !== 'incomplete';
        const isReopenUpdate = statusAfter === 'confirmed' && (statusBefore === 'completed' || statusBefore === 'incomplete');

        if (isIncompleteUpdate || isReopenUpdate) {
            logger.log("Silencing self-update notification.", {
                shiftId,
                userId,
                statusBefore,
                statusAfter,
            });
            return; // EXIT EARLY
        }
    }
    
    // SECOND: Check if a shift was reassigned from one user to another.
    if (before.userId !== after.userId) {
      if (before.userId) {
        const d = before.date?.toDate ? before.date.toDate() : null;
        await sendShiftNotification(
          before.userId,
          "Shift unassigned",
          d
            ? `Your shift for ${formatDateUK(d)} has been removed.`
            : "A shift has been removed.",
          "/dashboard",
          { shiftId, event: "unassigned" }
        );
      }
      if (after.userId) {
        const d = after.date?.toDate ? after.date.toDate() : null;
        if (d && !isShiftInPast(d)) {
          await sendShiftNotification(
            after.userId,
            "New shift added",
            `A new shift was added for ${formatDateUK(d)}`,
            pendingGateUrl(),
            { shiftId, gate: "pending", event: "assigned" }
          );
        }
      }
      logger.log("Shift reassigned", {
        shiftId,
        from: before.userId,
        to: after.userId,
      });
      return; // EXIT
    }

    // THIRD: Handle all other updates (e.g., admin changing details).
    if (!userId) return;

    const afterDate = after.date?.toDate ? after.date.toDate() : null;
    if (!afterDate) return;

    if (isShiftInPast(afterDate)) {
      logger.log("Shift updated but in past; no notify", { shiftId });
      return;
    }
    
    const fieldsToCompare: (keyof typeof before)[] = [
      "task",
      "address",
      "type",
      "notes",
      "status",
      "date",
    ];

    const changed = fieldsToCompare.some((field) => {
      if (field === "date") {
        const b = before.date;
        const a = after.date;
        if (b?.isEqual && a) return !b.isEqual(a);
        return String(b) !== String(a);
      }
      return (before[field] ?? null) !== (after[field] ?? null);
    });

    if (!changed) {
      logger.log("Shift updated but no meaningful change", { shiftId });
      return;
    }

    const needsAction = String(after.status || "").toLowerCase() === "pending-confirmation";
    await sendShiftNotification(
      userId,
      "Shift updated",
      `Your shift for ${formatDateUK(afterDate)} has been updated.`,
      needsAction ? pendingGateUrl() : `/shift/${shiftId}`,
      {
        shiftId,
        event: "updated",
        ...(needsAction ? { gate: "pending" } : {}),
      }
    );
});

export const onShiftDeleted = onDocumentDeleted({ document: "shifts/{shiftId}", region: europeWest2 }, async (event) => {
    const deleted = event.data?.data();
    if (!deleted) return;

    const userId = deleted.userId;
    if (!userId) return;

    const d = deleted.date?.toDate ? deleted.date.toDate() : null;
    const status = String(deleted.status || "").toLowerCase();
    const FINAL_STATUSES = new Set(["completed", "incomplete", "rejected"]);

    if (FINAL_STATUSES.has(status)) {
        logger.log("Shift deleted but was historical; no notify", {
        shiftId: event.params.shiftId,
        status,
        });
        return;
    }

    if (d && isShiftInPast(d)) {
        logger.log("Shift deleted but in past; no notify", {
        shiftId: event.params.shiftId,
        });
        return;
    }

    if (!d) {
        logger.log("Shift deleted but no date; skipping notify", {
        shiftId: event.params.shiftId,
        });
        return;
    }

    await sendShiftNotification(
        userId,
        "Shift removed",
        `Your shift for ${formatDateUK(d)} has been removed.`,
        "/dashboard",
        { shiftId: event.params.shiftId, event: "deleted" }
    );
});

export const geocodeShiftOnCreate = onDocumentCreated(
  "shifts/{shiftId}",
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const data = snap.data();

    // Must have a full address
    if (!data?.address) return;

    // Do not overwrite existing coordinates
    if (data?.location?.lat && data?.location?.lng) return;

    if (!GEOCODING_KEY) {
      console.error("Missing Geocoding API key");
      return;
    }

    const address = encodeURIComponent(`${data.address}, UK`);

    const url =
      `https://maps.googleapis.com/maps/api/geocode/json?` +
      `address=${address}&key=${GEOCODING_KEY}`;

    const res = await fetch(url);
    const json = (await res.json()) as any;

    if (json.status !== "OK" || !json.results?.length) {
      console.warn("Geocoding failed", data.address, json.status);
      return;
    }

    const result = json.results[0];
    const { lat, lng } = result.geometry.location;
    const accuracy = result.geometry.location_type;

    await snap.ref.update({
      location: {
        lat,
        lng,
        accuracy, // ROOFTOP | RANGE_INTERPOLATED | POSTAL_CODE
      },
    });
  }
);


/* =====================================================
   SCHEDULED FUNCTIONS
===================================================== */

export const projectReviewNotifier = onSchedule({ schedule: "every 24 hours", region: europeWest2 }, () => {
    logger.log("projectReviewNotifier executed.");
});

export const pendingShiftNotifier = onSchedule({ schedule: "every 1 hours", region: europeWest2 }, () => {
    logger.log("pendingShiftNotifier executed.");
});

export const getVapidPublicKey = onCall({ region: "europe-west2" }, () => {
  if (!WEBPUSH_PUBLIC_KEY) {
    logger.error("WEBPUSH_PUBLIC_KEY is not set in environment variables.");
    throw new functions.https.HttpsError(
      "failed-precondition",
      "VAPID public key is not configured on the server."
    );
  }
  return { publicKey: WEBPUSH_PUBLIC_KEY };
});
