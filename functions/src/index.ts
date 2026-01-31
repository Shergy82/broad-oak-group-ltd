import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { onCall, HttpsError, onRequest } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import * as webPush from "web-push";
import * as crypto from "crypto";

if (admin.apps.length === 0) admin.initializeApp();
const db = admin.firestore();

const VAPID_PUBLIC = process.env.WEBPUSH_PUBLIC_KEY || "";
const VAPID_PRIVATE = process.env.WEBPUSH_PRIVATE_KEY || "";
const VAPID_SUBJECT =
  process.env.WEBPUSH_SUBJECT || "mailto:example@your-project.com";

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
} else {
  logger.warn("VAPID keys not configured. Push notifications will not work.");
}

function subIdFromEndpoint(endpoint: string) {
  return Buffer.from(endpoint).toString("base64").replace(/=+$/g, "");
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

  for (const doc of snap.docs) {
    const sub = doc.data() as webPush.PushSubscription;

    try {
      await webPush.sendNotification(sub, payload);
      sent++;
    } catch (err: any) {
      const code = err?.statusCode;

      if (code === 404 || code === 410) {
        await doc.ref.delete();
        removed++;
      } else {
        logger.error("Push failed", err);
      }
    }
  }

  return { sent, removed };
}

function londonMidnightUtcMs(now: Date = new Date()): number {
  // Get YYYY-MM-DD in Europe/London, then compute that local midnight in UTC ms.
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const y = Number(parts.find(p => p.type === "year")?.value);
  const m = Number(parts.find(p => p.type === "month")?.value);
  const d = Number(parts.find(p => p.type === "day")?.value);

  // Start from UTC midnight for that date...
  const utcMidnight = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));

  // ...then see what London local time that UTC instant corresponds to.
  const hm = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(utcMidnight);

  const hh = Number(hm.find(p => p.type === "hour")?.value || "0");
  const mm = Number(hm.find(p => p.type === "minute")?.value || "0");

  // If London is ahead (summer time), UTC midnight shows as 01:00 London,
  // so London midnight was 1h earlier in UTC. Adjust by that offset.
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
  // Your schema:
  // - shift.date = Firestore Timestamp for the day (midnight)
  // - shift.type = "am" | "pm"
  const dayMs = toMillis(shift.date);
  if (dayMs !== null) {
    const t = (shift.type || "").toString().toLowerCase();
    // choose sensible defaults (adjust if your AM/PM times differ)
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
  return "{" + keys.map(k => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}

function getShiftEndMs(shift: any): number | null {
  const candidates = [
    shift.endAt,
    shift.end,
    shift.endsAt,
    shift.shiftEnd,
    shift.endTime,
    shift.endDate,
  ];
  for (const c of candidates) {
    const ms = toMillis(c);
    if (ms !== null) return ms;
  }
  return null;
}

function relevantShiftSignature(shift: any): string {
  // Only fields that should trigger a notification when changed.
  // Intentionally excludes status / worker confirmations / bookkeeping fields.
  const startMs = getShiftStartMs(shift);
  const endMs = getShiftEndMs(shift);

  const sig = {
    userId: shift.userId || shift.uid || null,
    startMs,
    endMs,
    // common “meaningful” fields (safe if absent)
    addressId: shift.addressId ?? null,
    address: shift.address ?? null,
    site: shift.site ?? null,
    role: shift.role ?? null,
    job: shift.job ?? null,
    notes: shift.notes ?? shift.note ?? null,
    // AM/PM style fields if you use them
    period: shift.period ?? shift.ampm ?? null,
  };

  return stableStringify(sig);
}

function hashSig(sig: string): string {
  return crypto.createHash("sha256").update(sig).digest("hex");
}


export const getVapidPublicKey = onCall({ region: "europe-west2" }, async () => {
  if (!VAPID_PUBLIC) {
    throw new HttpsError(
      "failed-precondition",
      "VAPID public key is not configured"
    );
  }
  return { publicKey: VAPID_PUBLIC };
});

export const setNotificationStatus = onCall(
  { region: "europe-west2" },
  async (req) => {
    if (!req.auth) {
      throw new HttpsError("unauthenticated", "Login required");
    }

    const uid = req.auth.uid;
    const data = req.data as any;

    const status = data?.status;
    const subscription = data?.subscription;
    const endpoint = data?.endpoint;

    const subs = db.collection("users").doc(uid).collection("pushSubscriptions");

    if (status === "subscribed") {
      if (!subscription?.endpoint) {
        throw new HttpsError("invalid-argument", "Bad subscription");
      }

      const id = subIdFromEndpoint(subscription.endpoint);

      await subs.doc(id).set(
        {
          endpoint: subscription.endpoint,
          keys: subscription.keys,
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

      const id = subIdFromEndpoint(endpoint);
      await subs.doc(id).delete();

      return { ok: true };
    }

    throw new HttpsError("invalid-argument", "Invalid status");
  }
);

// HTTP test endpoint
export const sendTestNotificationHttp = onRequest(
  { region: "europe-west2" },
  async (req, res) => {
    try {
      const uid = String(req.query.uid || "");

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
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  }
);

/**
 * Fires on create/update/delete.
 * - Create: before missing, after present
 * - Update: before present, after present
 * - Delete: before present, after missing
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

    // Must have a start date to be considered (otherwise can't decide past/future)
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

    // --- DELETE: notify cancellation (meaningful change)
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

    // --- CREATE / UPDATE:
    if (after) {
      const userId = (after as any).userId || (after as any).uid;
      if (!userId) return;

      const isCreate = !before && !!after;
      const isUpdate = !!before && !!after;

      // SMART DEDUPE:
      // 1) Ignore updates where only status/bookkeeping changed (e.g. worker confirms on site).
      if (isUpdate) {
        const beforeSig = relevantShiftSignature(before);
        const afterSig = relevantShiftSignature(after);

        if (beforeSig === afterSig) {
          logger.info("Skip notification (no meaningful shift changes)");
          return;
        }

        // 2) Optional extra guard: identical hashes (same as above, but robust for logging)
        const beforeHash = hashSig(beforeSig);
        const afterHash = hashSig(afterSig);
        if (beforeHash === afterHash) {
          logger.info("Skip notification (identical shift hash)");
          return;
        }
      }

      const result = await sendWebPushToUser(userId, {
        title: isCreate ? "New Shift Assigned" : "Shift Updated",
        body: isCreate
          ? "You have been assigned a new shift."
          : "One of your shifts has been updated.",
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



export const getNotificationStatus = onCall(
  { region: "europe-west2" },
  async (req) => {
    if (!req.auth) {
      throw new HttpsError("unauthenticated", "Login required");
    }

    const uid = req.auth.uid;

    const snap = await db
      .collection("users")
      .doc(uid)
      .collection("pushSubscriptions")
      .limit(1)
      .get();

    return { subscribed: !snap.empty };
  }
);
