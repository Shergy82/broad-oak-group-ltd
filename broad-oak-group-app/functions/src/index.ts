
'use client';
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { onRequest } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import * as webPush from "web-push";
import * as crypto from "crypto";
import * as JSZip from 'jszip';
import { getStorage } from 'firebase-admin/storage';
import * as cors from 'cors';

const corsHandler = cors({ origin: true });

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

async function verifyAuth(req: any): Promise<admin.auth.DecodedIdToken> {
    const token = req.headers.authorization?.split('Bearer ')[1];
    if (!token) {
        throw new Error("Unauthorized");
    }
    return await admin.auth().verifyIdToken(token);
}

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
  if (typeof v === "object" && typeof v.toMillis === "function") return v.toMillis();
  if (typeof v === "number") return v > 1e12 ? v : v * 1000;
  if (typeof v === "string") {
    const ms = Date.parse(v);
    return Number.isNaN(ms) ? null : ms;
  }
  if (typeof v === "object" && typeof v.seconds === "number") {
    return v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6);
  }
  return null;
}

function getShiftStartMs(shift: any): number | null {
  const dayMs = toMillis(shift.date);
  if (dayMs !== null) {
    const t = (shift.type || "").toString().toLowerCase();
    const hour = t === "pm" ? 12 : 6;
    return dayMs + hour * 60 * 60 * 1000;
  }
  const candidates = [
    shift.startAt, shift.start, shift.startsAt, shift.shiftStart,
    shift.startTime, shift.startDate, shift.date, shift.shiftDate, shift.day,
  ];
  for (const c of candidates) {
    const ms = toMillis(c);
    if (ms !== null) return ms;
  }
  return null;
}

function isCompletedShift(shift: any): boolean {
  const status = (shift.status || shift.state || "").toString().toLowerCase();
  return status === "completed" || status === "complete" || status === "done" ||
         shift.completed === true || shift.isCompleted === true || shift.complete === true;
}

function stableStringify(obj: any): string {
  if (obj === null || obj === undefined) return "";
  if (Array.isArray(obj)) return "[" + obj.map(stableStringify).join(",") + "]";
  if (typeof obj !== "object") return JSON.stringify(obj);
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}

function relevantShiftSignature(shift: any): string {
  const sig = {
    userId: shift.userId || shift.uid || null,
    startMs: getShiftStartMs(shift),
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
 *  Callable Functions (now onRequest)
 *  ========================= */

export const getVapidPublicKey = onRequest({ region: "europe-west2" }, (req, res) => {
  corsHandler(req, res, () => {
    if (!VAPID_PUBLIC) {
      return res.status(500).json({ error: { status: 'FAILED_PRECONDITION', message: 'VAPID public key is not configured' } });
    }
    return res.status(200).json({ data: { publicKey: VAPID_PUBLIC } });
  });
});

export const setNotificationStatus = onRequest({ region: "europe-west2" }, (req, res) => {
    corsHandler(req, res, async () => {
        if (req.method === 'OPTIONS') {
            res.status(204).send('');
            return;
        }
        try {
            const decodedToken = await verifyAuth(req);
            const data = req.body.data;
            const subs = db.collection("users").doc(decodedToken.uid).collection("pushSubscriptions");

            if (data?.status === "subscribed") {
                if (!data?.subscription?.endpoint) {
                    return res.status(400).json({ error: { status: 'INVALID_ARGUMENT', message: 'Bad subscription' } });
                }
                const id = data?.subId ? data.subId.trim() : subIdFromEndpoint(data.subscription.endpoint);
                await subs.doc(id).set({
                    endpoint: data.subscription.endpoint,
                    keys: data.subscription.keys,
                    subscription: data.subscription,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                }, { merge: true });
                return res.status(200).json({ data: { ok: true } });
            } else if (data?.status === "unsubscribed") {
                if (!data?.endpoint) {
                    return res.status(400).json({ error: { status: 'INVALID_ARGUMENT', message: 'Missing endpoint' } });
                }
                const id = data?.subId ? data.subId.trim() : subIdFromEndpoint(data.endpoint);
                await subs.doc(id).delete();
                return res.status(200).json({ data: { ok: true } });
            } else {
                return res.status(400).json({ error: { status: 'INVALID_ARGUMENT', message: 'Invalid status' } });
            }
        } catch (error: any) {
            logger.error('setNotificationStatus Error:', error);
            return res.status(500).json({ error: { status: 'INTERNAL', message: error.message } });
        }
    });
});

export const deleteAllShifts = onRequest({ region: "europe-west2" }, (req, res) => {
    corsHandler(req, res, async () => {
        if (req.method === 'OPTIONS') {
            res.status(204).send('');
            return;
        }
        try {
            const decodedToken = await verifyAuth(req);
            const userDoc = await db.collection("users").doc(decodedToken.uid).get();
            if (userDoc.data()?.role !== 'owner') {
                return res.status(403).json({ error: { status: 'PERMISSION_DENIED', message: 'Permission denied.' } });
            }

            const shiftsRef = db.collection("shifts");
            let totalDeleted = 0;
            while (true) {
                const snap = await shiftsRef.limit(400).get();
                if (snap.empty) break;
                const batch = db.batch();
                snap.docs.forEach((d) => batch.delete(d.ref));
                await batch.commit();
                totalDeleted += snap.size;
            }
            return res.status(200).json({ data: { ok: true, message: `Deleted ${totalDeleted} shift(s).` } });
        } catch (error: any) {
            logger.error('deleteAllShifts Error:', error);
            return res.status(500).json({ error: { status: 'INTERNAL', message: error.message } });
        }
    });
});

export const setUserStatus = onRequest({ region: "europe-west2" }, (req, res) => {
    corsHandler(req, res, async () => {
        if (req.method === 'OPTIONS') {
            res.status(204).send('');
            return;
        }
        try {
            const decodedToken = await verifyAuth(req);
            const userDoc = await db.collection("users").doc(decodedToken.uid).get();
            const userRole = userDoc.data()?.role;
            if (userRole !== 'admin' && userRole !== 'owner') {
                return res.status(403).json({ error: { status: 'PERMISSION_DENIED', message: 'Permission denied.' } });
            }

            const { uid, disabled, newStatus } = req.body.data;
            if (!uid || typeof disabled !== 'boolean' || !newStatus) {
                return res.status(400).json({ error: { status: 'INVALID_ARGUMENT', message: 'The function must be called with "uid", "disabled", and "newStatus" arguments.' } });
            }

            await admin.auth().updateUser(uid, { disabled });
            await db.collection('users').doc(uid).update({ status: newStatus });
            return res.status(200).json({ data: { success: true, message: `User ${uid} status updated to ${newStatus}.` } });
        } catch (error: any) {
            logger.error('setUserStatus Error:', error);
            return res.status(500).json({ error: { status: 'INTERNAL', message: error.message } });
        }
    });
});

export const deleteUser = onRequest({ region: "europe-west2" }, (req, res) => {
    corsHandler(req, res, async () => {
        if (req.method === 'OPTIONS') {
            res.status(204).send('');
            return;
        }
        try {
            const decodedToken = await verifyAuth(req);
            const userDoc = await db.collection("users").doc(decodedToken.uid).get();
            const userRole = userDoc.data()?.role;
            if (userRole !== 'admin' && userRole !== 'owner') {
                return res.status(403).json({ error: { status: 'PERMISSION_DENIED', message: 'Permission denied.' } });
            }
            const { uid } = req.body.data;
            if (!uid) {
                return res.status(400).json({ error: { status: 'INVALID_ARGUMENT', message: 'The function must be called with a "uid" argument.' } });
            }
            await admin.auth().deleteUser(uid);
            await db.collection('users').doc(uid).delete();
            return res.status(200).json({ data: { success: true, message: `User ${uid} has been permanently deleted.` } });
        } catch (error: any) {
            logger.error('deleteUser Error:', error);
            return res.status(500).json({ error: { status: 'INTERNAL', message: error.message } });
        }
    });
});

export const syncUserNamesToShifts = onRequest({ region: "europe-west2" }, (req, res) => {
    corsHandler(req, res, async () => {
        if (req.method === 'OPTIONS') {
            res.status(204).send('');
            return;
        }
        try {
            const decodedToken = await verifyAuth(req);
            const userDoc = await db.collection("users").doc(decodedToken.uid).get();
            if (userDoc.data()?.role !== 'owner') {
                return res.status(403).json({ error: { status: 'PERMISSION_DENIED', message: 'Permission denied.' } });
            }
            const usersSnapshot = await db.collection('users').get();
            const userNameMap = new Map<string, string>();
            usersSnapshot.forEach(doc => { userNameMap.set(doc.id, doc.data().name); });

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
            if (updates > 0) await batch.commit();
            return res.status(200).json({ data: { success: true, message: `Sync complete. ${updates} shift record(s) updated.` } });
        } catch (error: any) {
            logger.error('syncUserNamesToShifts Error:', error);
            return res.status(500).json({ error: { status: 'INTERNAL', message: error.message } });
        }
    });
});

export const deleteProjectFile = onRequest({ region: "europe-west2" }, (req, res) => {
    corsHandler(req, res, async () => {
        if (req.method === 'OPTIONS') {
            res.status(204).send('');
            return;
        }
        try {
            const decodedToken = await verifyAuth(req);
            const userDoc = await db.collection("users").doc(decodedToken.uid).get();
            const userRole = userDoc.data()?.role;
            if (!['owner', 'admin', 'manager'].includes(userRole)) {
                return res.status(403).json({ error: { status: 'PERMISSION_DENIED', message: 'Permission denied.' } });
            }
            const { projectId, fileId } = req.body.data;
            if (!projectId || !fileId) {
                return res.status(400).json({ error: { status: 'INVALID_ARGUMENT', message: 'Missing projectId or fileId.' } });
            }
            const fileDocRef = db.collection('projects').doc(projectId).collection('files').doc(fileId);
            const fileDoc = await fileDocRef.get();
            if (!fileDoc.exists) {
                return res.status(404).json({ error: { status: 'NOT_FOUND', message: 'File not found.' } });
            }
            const fileData = fileDoc.data();
            if (fileData?.fullPath) {
                await storage.bucket().file(fileData.fullPath).delete();
            }
            await fileDocRef.delete();
            return res.status(200).json({ data: { success: true } });
        } catch (error: any) {
            logger.error('deleteProjectFile Error:', error);
            return res.status(500).json({ error: { status: 'INTERNAL', message: error.message } });
        }
    });
});

export const deleteProjectAndFiles = onRequest({ region: "europe-west2" }, (req, res) => {
    corsHandler(req, res, async () => {
        if (req.method === 'OPTIONS') {
            res.status(204).send('');
            return;
        }
        try {
            const decodedToken = await verifyAuth(req);
            const userDoc = await db.collection("users").doc(decodedToken.uid).get();
            const userRole = userDoc.data()?.role;
            if (!['owner', 'admin', 'manager'].includes(userRole)) {
                return res.status(403).json({ error: { status: 'PERMISSION_DENIED', message: 'Permission denied.' } });
            }
            const { projectId } = req.body.data;
            if (!projectId) {
                return res.status(400).json({ error: { status: 'INVALID_ARGUMENT', message: 'Missing projectId.' } });
            }
            const projectRef = db.collection('projects').doc(projectId);
            if (!(await projectRef.get()).exists) {
                return res.status(404).json({ error: { status: 'NOT_FOUND', message: 'Project not found.' } });
            }
            await storage.bucket().deleteFiles({ prefix: `project_files/${projectId}` });
            const filesSubcollection = projectRef.collection('files');
            const filesSnapshot = await filesSubcollection.get();
            const batch = db.batch();
            filesSnapshot.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
            await projectRef.delete();
            return res.status(200).json({ data: { success: true, message: `Successfully deleted project ${projectId} and its files.` } });
        } catch (error: any) {
            logger.error('deleteProjectAndFiles Error:', error);
            return res.status(500).json({ error: { status: 'INTERNAL', message: error.message } });
        }
    });
});

export const deleteAllProjects = onRequest({ region: "europe-west2" }, (req, res) => {
    corsHandler(req, res, async () => {
        if (req.method === 'OPTIONS') {
            res.status(204).send('');
            return;
        }
        try {
            const decodedToken = await verifyAuth(req);
            const userDoc = await db.collection("users").doc(decodedToken.uid).get();
            if (userDoc.data()?.role !== 'owner') {
                return res.status(403).json({ error: { status: 'PERMISSION_DENIED', message: 'Permission denied.' } });
            }
            const projectsSnapshot = await db.collection('projects').get();
            let deletedProjects = 0;
            for (const doc of projectsSnapshot.docs) {
                await storage.bucket().deleteFiles({ prefix: `project_files/${doc.id}` });
                const filesSubcollection = doc.ref.collection('files');
                const filesSnapshot = await filesSubcollection.get();
                const batch = db.batch();
                filesSnapshot.forEach(fileDoc => batch.delete(fileDoc.ref));
                await batch.commit();
                await doc.ref.delete();
                deletedProjects++;
            }
            return res.status(200).json({ data: { success: true, message: `Successfully deleted ${deletedProjects} projects and their files.` } });
        } catch (error: any) {
            logger.error('deleteAllProjects Error:', error);
            return res.status(500).json({ error: { status: 'INTERNAL', message: error.message } });
        }
    });
});

export const zipProjectFiles = onRequest({ region: "europe-west2", timeoutSeconds: 300 }, (req, res) => {
    corsHandler(req, res, async () => {
        if (req.method === 'OPTIONS') {
            res.status(204).send('');
            return;
        }
        try {
            await verifyAuth(req);
            const { projectId } = req.body.data;
            if (!projectId) {
                return res.status(400).json({ error: { status: 'INVALID_ARGUMENT', message: 'Missing projectId.' } });
            }
            const filesSnapshot = await db.collection('projects').doc(projectId).collection('files').get();
            if (filesSnapshot.empty) {
                return res.status(404).json({ error: { status: 'NOT_FOUND', message: 'No files found for this project.' } });
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
            const [signedUrl] = await zipFile.getSignedUrl({ action: 'read', expires: Date.now() + 15 * 60 * 1000 });
            return res.status(200).json({ data: { downloadUrl: signedUrl } });
        } catch (error: any) {
            logger.error('zipProjectFiles Error:', error);
            return res.status(500).json({ error: { status: 'INTERNAL', message: error.message } });
        }
    });
});


/** =========================
 *  Firestore Trigger
 *  ========================= */

export const onShiftWrite = onDocumentWritten(
  { region: "europe-west2", document: "shifts/{shiftId}" },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();

    const todayStartUtc = londonMidnightUtcMs(new Date()) - 5 * 60 * 1000;
    const doc: any = after || before;
    if (!doc) return;

    const startMs = getShiftStartMs(doc);
    if (startMs === null) {
      logger.info("Skip notification (no shift start date/time found)");
      return;
    }
    if (startMs < todayStartUtc) {
      logger.info("Skip notification (past shift)", { startMs, todayStartUtc });
      return;
    }
    if (isCompletedShift(doc)) {
      logger.info("Skip notification for completed shift");
      return;
    }

    if (before && !after) { // DELETE
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

    if (after) { // CREATE / UPDATE
      const userId = (after as any).userId || (after as any).uid;
      if (!userId) return;

      const isCreate = !before && !!after;
      const isUpdate = !!before && !!after;

      if (isUpdate) {
        const beforeSig = relevantShiftSignature(before);
        const afterSig = relevantShiftSignature(after);
        if (beforeSig === afterSig || hashSig(beforeSig) === hashSig(afterSig)) {
          logger.info("Skip notification (no meaningful shift changes)");
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
