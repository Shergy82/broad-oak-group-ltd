import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { onCall, HttpsError, onRequest } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as webPush from "web-push";
import * as crypto from "crypto";

/* =========================================================
 *  Bootstrap
 * ========================================================= */
if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

/* =========================================================
 *  Environment (Functions v2)
 * ========================================================= */
const VAPID_PUBLIC = process.env.WEBPUSH_PUBLIC_KEY ?? "";
const VAPID_PRIVATE = process.env.WEBPUSH_PRIVATE_KEY ?? "";
const VAPID_SUBJECT =
  process.env.WEBPUSH_SUBJECT ?? "mailto:example@your-project.com";

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
} else {
  logger.warn("VAPID keys not configured – push disabled");
}

/* =========================================================
 *  Helpers
 * ========================================================= */

function subIdFromEndpoint(endpoint: string): string {
  return Buffer.from(endpoint)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function sendWebPushToUser(
  uid: string,
  payload: Record<string, any>
): Promise<{ sent: number; removed: number }> {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return { sent: 0, removed: 0 };
  }

  const snap = await db
    .collection("users")
    .doc(uid)
    .collection("pushSubscriptions")
    .get();

  if (snap.empty) return { sent: 0, removed: 0 };

  let sent = 0;
  let removed = 0;
  const body = JSON.stringify(payload);

  for (const doc of snap.docs) {
    const data = doc.data();

    const sub: webPush.PushSubscription | null =
      data?.subscription?.endpoint
        ? data.subscription
        : data?.endpoint && data?.keys
        ? { endpoint: data.endpoint, keys: data.keys }
        : null;

    if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
      await doc.ref.delete();
      removed++;
      continue;
    }

    try {
      await webPush.sendNotification(sub, body);
      sent++;
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) {
        await doc.ref.delete();
        removed++;
      } else {
        logger.error("Push failed", e);
      }
    }
  }

  return { sent, removed };
}

function toMillis(v: any): number | null {
  if (!v) return null;
  if (typeof v === "number") return v > 1e12 ? v : v * 1000;
  if (typeof v === "string") {
    const ms = Date.parse(v);
    return Number.isNaN(ms) ? null : ms;
  }
  if (typeof v?.toMillis === "function") return v.toMillis();
  if (typeof v?.seconds === "number") {
    return v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6);
  }
  return null;
}

function getShiftStartMs(shift: any): number | null {
  const dayMs = toMillis(shift.date);
  if (dayMs !== null) {
    const hour = String(shift.type).toLowerCase() === "pm" ? 12 : 6;
    return dayMs + hour * 60 * 60 * 1000;
  }

  return toMillis(
    shift.startAt ??
      shift.start ??
      shift.startsAt ??
      shift.startTime ??
      shift.startDate
  );
}

function getShiftEndMs(shift: any): number | null {
  return toMillis(
    shift.endAt ??
      shift.end ??
      shift.endsAt ??
      shift.endTime ??
      shift.endDate
  );
}

function isCompletedShift(shift: any): boolean {
  const s = String(shift.status ?? "").toLowerCase();
  return (
    s === "completed" ||
    s === "complete" ||
    s === "done" ||
    shift.completed === true
  );
}

function stableStringify(obj: any): string {
  if (obj === null || obj === undefined) return "";
  if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(",")}]`;
  if (typeof obj !== "object") return JSON.stringify(obj);
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `"${k}":${stableStringify(obj[k])}`)
    .join(",")}}`;
}

function hashSig(sig: string): string {
  return crypto.createHash("sha256").update(sig).digest("hex");
}

/* =========================================================
 *  Callable / HTTP
 * ========================================================= */

export const getVapidPublicKey = onCall(
  { region: "europe-west2" },
  async () => {
    if (!VAPID_PUBLIC) {
      throw new HttpsError(
        "failed-precondition",
        "VAPID public key not configured"
      );
    }
    return { publicKey: VAPID_PUBLIC };
  }
);

export const setNotificationStatus = onCall(
  { region: "europe-west2" },
  async (req) => {
    if (!req.auth) throw new HttpsError("unauthenticated", "Login required");

    const { status, subscription, endpoint, subId } = req.data || {};
    const uid = req.auth.uid;

    const subs = db
      .collection("users")
      .doc(uid)
      .collection("pushSubscriptions");

    if (status === "subscribed") {
      if (!subscription?.endpoint) {
        throw new HttpsError("invalid-argument", "Invalid subscription");
      }
      const id = subId?.trim() || subIdFromEndpoint(subscription.endpoint);
      await subs.doc(id).set(
        {
          endpoint: subscription.endpoint,
          keys: subscription.keys,
          subscription,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      return { ok: true };
    }

    if (status === "unsubscribed") {
      if (!endpoint) {
        throw new HttpsError("invalid-argument", "Missing endpoint");
      }
      const id = subId?.trim() || subIdFromEndpoint(endpoint);
      await subs.doc(id).delete();
      return { ok: true };
    }

    throw new HttpsError("invalid-argument", "Invalid status");
  }
);

export const sendTestNotificationHttp = onRequest(
  { region: "europe-west2", cors: true },
  async (req, res) => {
    const uid = String(req.query.uid ?? "");
    if (!uid) {
      res.status(400).json({ ok: false, error: "Missing uid" });
      return;
    }

    const result = await sendWebPushToUser(uid, {
      title: "Test Notification",
      body: "Push is working",
      url: "/",
    });

    res.json({ ok: true, ...result });
  }
);

/* =========================================================
 *  Firestore trigger
 * ========================================================= */

export const onShiftWrite = onDocumentWritten(
  { region: "europe-west2", document: "shifts/{shiftId}" },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    const doc = after ?? before;
    if (!doc) return;

    const startMs = getShiftStartMs(doc);
    if (startMs === null || isCompletedShift(doc)) return;

    const uid = doc.userId ?? doc.uid;
    if (!uid) return;

    await sendWebPushToUser(uid, {
      title: after && !before ? "New Shift Assigned" : "Shift Updated",
      body: "Your shift details have changed.",
      url: "/dashboard",
    });
  }
);

/* =========================================================
 *  Scheduled cleanup (FIXED – v2 compliant)
 * ========================================================= */

export const cleanupDeletedProjects = onSchedule(
  {
    schedule: "every 24 hours",
    region: "europe-west2",
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async (_event): Promise<void> => {
    logger.info("Running project cleanup");

    const cutoff = admin.firestore.Timestamp.fromDate(
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    );

    const snap = await db
      .collection("projects")
      .where("deletionScheduledAt", "<=", cutoff)
      .get();

    if (snap.empty) return;

    const bucket = admin.storage().bucket();

    for (const doc of snap.docs) {
      const projectId = doc.id;

      await bucket.deleteFiles({
        prefix: `project_files/${projectId}/`,
        force: true,
      });

      const filesSnap = await doc.ref.collection("files").limit(500).get();
      if (!filesSnap.empty) {
        const batch = db.batch();
        filesSnap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }

      await doc.ref.delete();
      logger.info("Deleted project", { projectId });
    }
  }
);

export { serveFile } from "./files";
