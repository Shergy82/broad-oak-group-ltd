
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import * as webPush from "web-push";
import * as crypto from "crypto";
import * as JSZip from 'jszip';
import { getStorage } from 'firebase-admin/storage';


if (admin.apps.length === 0) admin.initializeApp();
const db = admin.firestore();
const storage = getStorage();

/** =========================
 *  ENV (Cloud Functions v2)
 *  ========================= */
const VAPID_PUBLIC = process.env.WEBPUSH_PUBLIC_KEY || "";
const VAPID_PRIVATE = process.env.WEBPUSH_PRIVATE_KEY || "";
const VAPID_SUBJECT = process.env.WEBPUSH_SUBJECT || "mailto:example@your-project.com";

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
} else {
  logger.warn("VAPID keys not configured. Push notifications will not work.");
}

/** =========================
 *  Helpers
 *  ========================= */

/**
 * Firestore doc IDs must NOT contain '/'.
 * Use base64url so the ID is always safe.
 */
function subIdFromEndpoint(endpoint: string) {
  return Buffer.from(endpoint)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function sendWebPushToUser(uid: string, payloadObj: any) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    logger.error("VAPID not configured");
    return { sent: 0, removed: 0 };
  }

  const snap = await db.collection(`users/${uid}/pushSubscriptions`).get();
  if (snap.empty) {
    logger.info("No push subs for user", { uid });
    return { sent: 0, removed: 0 };
  }

  const payload = JSON.stringify(payloadObj);

  let sent = 0;
  let removed = 0;

  for (const docSnap of snap.docs) {
    const data = docSnap.data() as any;

    // Support both shapes:
    // - { endpoint, keys }
    // - { subscription: { endpoint, keys } }
    const sub: webPush.PushSubscription =
      data?.subscription && data?.subscription?.endpoint
        ? data.subscription
        : {
            endpoint: data.endpoint,
            keys: data.keys,
          };

    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
      logger.warn("Invalid subscription doc; deleting", { uid, id: docSnap.id });
      await docSnap.ref.delete();
      removed++;
      continue;
    }

    try {
      await webPush.sendNotification(sub, payload);
      sent++;
    } catch (err: any) {
      const code = err?.statusCode;

      if (code === 404 || code === 410) {
        await docSnap.ref.delete();
        removed++;
      } else {
        logger.error("Push failed", err);
      }
    }
  }

  return { sent, removed };
}

function londonMidnightUtcMs(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  const d = Number(parts.find((p) => p.type === "day")?.value);

  const utcMidnight = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));

  const hm = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(utcMidnight);

  const hh = Number(hm.find((p) => p.type === "hour")?.value || "0");
  const mm = Number(hm.find((p) => p.type === "minute")?.value || "0");

  return utcMidnight.getTime() - (hh * 60 + mm) * 60 * 1000;
}

function toMillis(v: any): number | null {
  if (!v) return null;

  // Firestore Timestamp
  if (typeof v === "object" && typeof v.toMillis === "function") return v.toMillis();

  // number: ms or seconds
  if (typeof v === "number") return v > 1e12 ? v : v * 1000;

  // string date
  if (typeof v === "string") {
    const ms = Date.parse(v);
    return Number.isNaN(ms) ? null : ms;
  }

  // { seconds, nanoseconds }
  if (typeof v === "object" && typeof v.seconds === "number") {
    return v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6);
  }

  return null;
}

function getShiftStartMs(shift: any): number | null {
  // Current schema:
  // - shift.date = Firestore Timestamp for the day (midnight)
  // - shift.type = "am" | "pm"
  const dayMs = toMillis(shift.date);
  if (dayMs !== null) {
    const t = (shift.type || "").toString().toLowerCase();
    const hour = t === "pm" ? 12 : 6;
    return dayMs + hour * 60 * 60 * 1000;
  }

  // Fallbacks (older schemas)
  const candidates = [
    shift.startAt,
    shift.start,
    shift.startsAt,
    shift.shiftStart,
    shift.startTime,
    shift.startDate,
    shift.date,
    shift.shiftDate,
    shift.day,
  ];

  for (const c of candidates) {
    const ms = toMillis(c);
    if (ms !== null) return ms;
  }

  return null;
}

function isCompletedShift(shift: any): boolean {
  const status = (shift.status || shift.state || "").toString().toLowerCase();
  if (status === "completed" || status === "complete" || status === "done") return true;
  if (shift.completed === true) return true;
  if (shift.isCompleted === true) return true;
  if (shift.complete === true) return true;
  return false;
}

function stableStringify(obj: any): string {
  if (obj === null || obj === undefined) return "";
  if (Array.isArray(obj)) return "[" + obj.map(stableStringify).join(",") + "]";
  if (typeof obj !== "object") return JSON.stringify(obj);
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}

function relevantShiftSignature(shift: any): string {
  // Only fields that should trigger a notification when changed.
  // Intentionally excludes status / confirmations / bookkeeping.
  const startMs = getShiftStartMs(shift);

  const sig = {
    userId: shift.userId || shift.uid || null,
    startMs,
    address: shift.address ?? null,
    task: shift.task ?? null,
    type: shift.type ?? null,
  };

  return stableStringify(sig);
}

function hashSig(sig: string): string {
  return crypto.createHash("sha256").update(sig).digest("hex");
}

/** =========================
 *  Callable / HTTP Functions
 *  ========================= */

export const getVapidPublicKey = onCall({ region: "europe-west2" }, async () => {
  if (!VAPID_PUBLIC) {
    throw new HttpsError("failed-precondition", "VAPID public key is not configured");
  }
  return { publicKey: VAPID_PUBLIC };
});

export const setNotificationStatus = onCall({ region: "europe-west2" }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Login required");

  const uid = req.auth.uid;
  const data = req.data as any;

  const status = data?.status;
  const subscription = data?.subscription;
  const endpoint = data?.endpoint;

  const subs = db.collection("users").doc(uid).collection("pushSubscriptions");

  if (status === "subscribed") {
    if (!subscription?.endpoint) throw new HttpsError("invalid-argument", "Bad subscription");

    const id =
      typeof data?.subId === "string" && data.subId.trim()
        ? data.subId.trim()
        : subIdFromEndpoint(subscription.endpoint);

    await subs.doc(id).set(
      {
        endpoint: subscription.endpoint,
        keys: subscription.keys,
        subscription, // keep full copy (helps compatibility)
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return { ok: true };
  }

  if (status === "unsubscribed") {
    if (!endpoint) throw new HttpsError("invalid-argument", "Missing endpoint");

    const id =
      typeof data?.subId === "string" && data.subId.trim()
        ? data.subId.trim()
        : subIdFromEndpoint(endpoint);

    await subs.doc(id).delete();
    return { ok: true };
  }

  throw new HttpsError("invalid-argument", "Invalid status");
});


export const deleteAllShifts = onCall({ region: "europe-west2" }, async (req) => {
    if (!req.auth?.uid) throw new HttpsError("unauthenticated", "Authentication required.");
    const userDoc = await db.collection("users").doc(req.auth.uid).get();
    if (userDoc.data()?.role !== 'owner') {
        throw new HttpsError('permission-denied', 'You must be an owner to perform this action.');
    }

  const shiftsRef = db.collection("shifts");
  let totalDeleted = 0;

  // Chunk deletes to avoid Firestore batch limit (500) and reduce timeouts
  while (true) {
    const snap = await shiftsRef.limit(400).get();
    if (snap.empty) break;

    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();

    totalDeleted += snap.size;
  }

  return { ok: true, message: `Deleted ${totalDeleted} shift(s).` };
});


export const setUserStatus = onCall({ region: "europe-west2" }, async (req) => {
    if (!req.auth?.uid) throw new HttpsError("unauthenticated", "Authentication required.");
    const userDoc = await db.collection("users").doc(req.auth.uid).get();
    const userRole = userDoc.data()?.role;
    if (userRole !== 'admin' && userRole !== 'owner') {
        throw new HttpsError('permission-denied', 'You must be an admin or owner to perform this action.');
    }

    const { uid, disabled, newStatus } = req.data;

    if (!uid || typeof disabled !== 'boolean' || !newStatus) {
        throw new HttpsError('invalid-argument', 'The function must be called with "uid", "disabled", and "newStatus" arguments.');
    }

    try {
        await admin.auth().updateUser(uid, { disabled });
        await db.collection('users').doc(uid).update({ status: newStatus });
        return { success: true, message: `User ${uid} status updated to ${newStatus}.` };
    } catch (error: any) {
        logger.error("Error updating user status:", {uid, error});
        throw new HttpsError('internal', error.message || 'An unknown error occurred while updating user status.');
    }
});

export const deleteUser = onCall({ region: "europe-west2" }, async (req) => {
    if (!req.auth?.uid) throw new HttpsError("unauthenticated", "Authentication required.");
    const userDoc = await db.collection("users").doc(req.auth.uid).get();
    const userRole = userDoc.data()?.role;
    if (userRole !== 'admin' && userRole !== 'owner') {
        throw new HttpsError('permission-denied', 'You must be an admin or owner to perform this action.');
    }

    const { uid } = req.data;
    if (!uid) {
        throw new HttpsError('invalid-argument', 'The function must be called with a "uid" argument.');
    }

    try {
        await admin.auth().deleteUser(uid);
        await db.collection('users').doc(uid).delete();
        // Note: Does not delete subcollections like pushSubscriptions or shifts. A more robust solution would.
        return { success: true, message: `User ${uid} has been permanently deleted.` };
    } catch (error: any) {
        logger.error("Error deleting user:", {uid, error});
        throw new HttpsError('internal', error.message || 'An unknown error occurred while deleting the user.');
    }
});

export const syncUserNamesToShifts = onCall({ region: "europe-west2" }, async (req) => {
    if (!req.auth?.uid) throw new HttpsError("unauthenticated", "Authentication required.");
    const userDoc = await db.collection("users").doc(req.auth.uid).get();
    if (userDoc.data()?.role !== 'owner') {
        throw new HttpsError('permission-denied', 'You must be an owner to perform this action.');
    }

    try {
        const usersSnapshot = await db.collection('users').get();
        const userNameMap = new Map<string, string>();
        usersSnapshot.forEach(doc => {
            userNameMap.set(doc.id, doc.data().name);
        });

        const shiftsSnapshot = await db.collection('shifts').get();
        const batch = db.batch();
        let updates = 0;

        shiftsSnapshot.forEach(doc => {
            const shift = doc.data();
            const correctName = userNameMap.get(shift.userId);
            if (correctName && shift.userName !== correctName) {
                batch.update(doc.ref, { userName: correctName });
                updates++;
            }
        });

        if (updates > 0) {
            await batch.commit();
        }

        return { success: true, message: `Sync complete. ${updates} shift record(s) updated.` };

    } catch (error: any) {
        logger.error("Error syncing user names to shifts:", error);
        throw new HttpsError('internal', error.message || 'An unknown error occurred during the sync.');
    }
});

export const deleteProjectFile = onCall({ region: "europe-west2" }, async (req) => {
    if (!req.auth?.uid) throw new HttpsError("unauthenticated", "Authentication required.");
    const userDoc = await db.collection("users").doc(req.auth.uid).get();
    const userRole = userDoc.data()?.role;
    if (!['owner', 'admin', 'manager'].includes(userRole)) {
        throw new HttpsError('permission-denied', 'You do not have permission to delete files.');
    }

    const { projectId, fileId } = req.data;
    if (!projectId || !fileId) {
        throw new HttpsError('invalid-argument', 'Missing projectId or fileId.');
    }

    try {
        const fileDocRef = db.collection('projects').doc(projectId).collection('files').doc(fileId);
        const fileDoc = await fileDocRef.get();
        if (!fileDoc.exists) {
            throw new HttpsError('not-found', 'File not found.');
        }
        const fileData = fileDoc.data();
        if(fileData?.fullPath) {
            await storage.bucket().file(fileData.fullPath).delete();
        }
        await fileDocRef.delete();
        return { success: true };
    } catch (error: any) {
        logger.error("Error deleting project file:", error);
        throw new HttpsError('internal', error.message || 'Failed to delete project file.');
    }
});

export const deleteProjectAndFiles = onCall({ region: "europe-west2" }, async (req) => {
    if (!req.auth?.uid) throw new HttpsError("unauthenticated", "Authentication required.");
    const userDoc = await db.collection("users").doc(req.auth.uid).get();
    const userRole = userDoc.data()?.role;
    if (!['owner', 'admin', 'manager'].includes(userRole)) {
        throw new HttpsError('permission-denied', 'You do not have permission to delete projects.');
    }
    
    const { projectId } = req.data;
    if (!projectId) {
        throw new HttpsError('invalid-argument', 'Missing projectId.');
    }

    try {
        const projectRef = db.collection('projects').doc(projectId);
        const projectDocSnap = await projectRef.get();
        if (!projectDocSnap.exists) {
            throw new HttpsError('not-found', 'Project not found.');
        }

        // Delete files in storage
        await storage.bucket().deleteFiles({ prefix: `project_files/${projectId}` });
        
        // This relies on the "delete-collections" extension or similar functionality.
        // It's a placeholder for a recursive delete implementation.
        const filesSubcollection = projectRef.collection('files');
        const filesSnapshot = await filesSubcollection.get();
        const batch = db.batch();
        filesSnapshot.forEach(doc => batch.delete(doc.ref));
        await batch.commit();

        await projectRef.delete();
        
        return { success: true, message: `Successfully deleted project ${projectId} and its files.`};

    } catch (error: any) {
        logger.error("Error deleting project:", { projectId, error });
        throw new HttpsError('internal', error.message || 'Failed to delete project.');
    }
});


export const deleteAllProjects = onCall({ region: "europe-west2" }, async (req) => {
    if (!req.auth?.uid) throw new HttpsError("unauthenticated", "Authentication required.");
    const userDoc = await db.collection("users").doc(req.auth.uid).get();
    if (userDoc.data()?.role !== 'owner') {
        throw new HttpsError('permission-denied', 'You must be an owner to delete all projects.');
    }
    
    try {
        const projectsSnapshot = await db.collection('projects').get();
        let deletedProjects = 0;
        
        for (const doc of projectsSnapshot.docs) {
            await storage.bucket().deleteFiles({ prefix: `project_files/${doc.id}` });
            
            // This relies on the "delete-collections" extension or similar functionality.
            const filesSubcollection = doc.ref.collection('files');
            const filesSnapshot = await filesSubcollection.get();
            const batch = db.batch();
            filesSnapshot.forEach(fileDoc => batch.delete(fileDoc.ref));
            await batch.commit();

            await doc.ref.delete();
            deletedProjects++;
        }
        
        return { success: true, message: `Successfully deleted ${deletedProjects} projects and their files.`};

    } catch (error: any) {
        logger.error("Error deleting all projects:", error);
        throw new HttpsError('internal', error.message || 'Failed to delete all projects.');
    }
});

export const zipProjectFiles = onCall({ region: "europe-west2", timeoutSeconds: 300 }, async (req) => {
    if (!req.auth?.uid) {
        throw new HttpsError('unauthenticated', 'You must be logged in.');
    }
    const { projectId } = req.data;
    if (!projectId) {
        throw new HttpsError('invalid-argument', 'Missing projectId.');
    }

    try {
        const filesSnapshot = await db.collection('projects').doc(projectId).collection('files').get();
        if (filesSnapshot.empty) {
            throw new HttpsError('not-found', 'No files found for this project.');
        }

        const zip = new JSZip();
        
        for (const doc of filesSnapshot.docs) {
            const fileData = doc.data();
            const file = storage.bucket().file(fileData.fullPath);
            const [buffer] = await file.download();
            zip.file(fileData.name, buffer);
        }
        
        const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
        const zipFileName = `project_${projectId}_${Date.now()}.zip`;
        const zipFile = storage.bucket().file(`temp_zips/${zipFileName}`);
        
        await zipFile.save(zipBuffer, { contentType: 'application/zip' });
        
        const [signedUrl] = await zipFile.getSignedUrl({
            action: 'read',
            expires: Date.now() + 15 * 60 * 1000, // 15 minutes
        });
        
        return { downloadUrl: signedUrl };

    } catch (error: any) {
        logger.error("Error zipping files:", error);
        throw new HttpsError('internal', error.message || 'Failed to create zip file.');
    }
});


/** =========================
 *  Firestore Trigger
 *  ========================= */

/**
 * Fires on create/update/delete.
 */
export const onShiftWrite = onDocumentWritten(
  { region: "europe-west2", document: "shifts/{shiftId}" },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();

    const todayStartUtc = londonMidnightUtcMs(new Date()) - 5 * 60 * 1000;

    // Use after if present, else before for deletes
    const doc: any = after || before;
    if (!doc) return;

    // Must have a start date/time to be considered
    const startMs = getShiftStartMs(doc);
    if (startMs === null) {
      logger.info("Skip notification (no shift start date/time found)");
      return;
    }

    // Only notify for today + future
    if (startMs < todayStartUtc) {
      logger.info("Skip notification (past shift)", { startMs, todayStartUtc });
      return;
    }

    // Never notify for completed shifts
    if (isCompletedShift(doc)) {
      logger.info("Skip notification for completed shift");
      return;
    }

    // DELETE: cancellation
    if (before && !after) {
      const userId = (before as any).userId || (before as any).uid;
      if (!userId) return;

      const result = await sendWebPushToUser(userId, {
        title: "Shift Cancelled",
        body: "A shift you were assigned to has been cancelled.",
        url: "/dashboard",
      });

      logger.info("Shift delete push done", { userId, ...result });
      return;
    }

    // CREATE / UPDATE
    if (after) {
      const userId = (after as any).userId || (after as any).uid;
      if (!userId) return;

      const isCreate = !before && !!after;
      const isUpdate = !!before && !!after;

      // Dedupe: ignore updates where only bookkeeping changed
      if (isUpdate) {
        const beforeSig = relevantShiftSignature(before);
        const afterSig = relevantShiftSignature(after);

        if (beforeSig === afterSig) {
          logger.info("Skip notification (no meaningful shift changes)");
          return;
        }

        const beforeHash = hashSig(beforeSig);
        const afterHash = hashSig(afterSig);
        if (beforeHash === afterHash) {
          logger.info("Skip notification (identical shift hash)");
          return;
        }
      }

      const result = await sendWebPushToUser(userId, {
        title: isCreate ? "New Shift Assigned" : "Shift Updated",
        body: isCreate ? "You have been assigned a new shift." : "One of your shifts has been updated.",
        url: "/dashboard",
      });

      logger.info("Shift write push done", {
        userId,
        kind: isCreate ? "create" : isUpdate ? "update" : "write",
        ...result,
      });
    }
  }
);

    