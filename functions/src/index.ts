// functions/src/index.ts

import admin from "firebase-admin";
import { logger } from "firebase-functions/v2";
import { onCall, onRequest } from "firebase-functions/v2/https";
import {
  onDocumentCreated,
  onDocumentDeleted,
  onDocumentUpdated,
} from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineString, defineSecret } from "firebase-functions/params";

// --- Admin init ---
if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

// --- Config / params ---
const APP_BASE_URL = defineString("APP_BASE_URL");
const ADMIN_BOOTSTRAP_SECRET = defineSecret("ADMIN_BOOTSTRAP_SECRET");
const europeWest2 = "europe-west2";

// --------------------
// BOOTSTRAP (one-time) - sets custom claims owner/admin
// --------------------
export const bootstrapClaims = onRequest(
  { secrets: [ADMIN_BOOTSTRAP_SECRET], region: europeWest2 },
  async (req, res): Promise<void> => {
    try {
      if (req.method !== "POST") {
        res.status(405).send("Use POST");
        return;
      }

      const headerSecret = req.get("x-admin-secret") || "";
      const realSecret = ADMIN_BOOTSTRAP_SECRET.value();

      if (!realSecret || headerSecret !== realSecret) {
        res.status(401).send("Unauthorized");
        return;
      }

      const uid = String(req.query.uid || "").trim();
      if (!uid) {
        res.status(400).send("Missing uid");
        return;
      }

      await admin.auth().setCustomUserClaims(uid, {
        // booleans
        owner: true,
        admin: true,
        isOwner: true,
        isAdmin: true,
      
        // role-style claims
        role: "owner",
        roles: ["owner", "admin"],
        permissions: { owner: true, admin: true },
      });      

      const after = await admin.auth().getUser(uid);
      const claims = after.customClaims || {};

      res.status(200).json({ ok: true, uid, claims });
      return;
    } catch (e: any) {
      res.status(500).send(e?.message || String(e));
      return;
    }
  }
);

// --------------------
// Helpers
// --------------------

/**
 * Firestore path where we store FCM tokens:
 * users/{uid}/pushTokens/{tokenDocId}
 * { token: string, updatedAt: Timestamp, userAgent?: string, platform?: string }
 */
async function getUserFcmTokens(userId: string): Promise<string[]> {
  const snap = await db
    .collection("users")
    .doc(userId)
    .collection("pushTokens")
    .get();

  if (snap.empty) return [];

  const tokens: string[] = [];
  for (const docSnap of snap.docs) {
    const data = docSnap.data() as any;
    const t = (data.token || data.fcmToken || docSnap.id || "")
      .toString()
      .trim();
    if (t) tokens.push(t);
  }
  return Array.from(new Set(tokens));
}

async function pruneInvalidTokens(userId: string, invalidTokens: string[]) {
  if (!invalidTokens.length) return;

  const col = db.collection("users").doc(userId).collection("pushTokens");
  const snap = await col.get();

  const batch = db.batch();
  for (const d of snap.docs) {
    const data = d.data() as any;
    const t = (data.token || data.fcmToken || d.id || "").toString().trim();
    if (invalidTokens.includes(t)) batch.delete(d.ref);
  }
  await batch.commit();
  logger.log("Pruned invalid tokens", { userId, count: invalidTokens.length });
}

function formatDateUK(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getUTCFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

/**
 * Returns true if the shift is on a day strictly before "today".
 * Compare by UTC day to avoid timezone drift.
 */
function isShiftInPast(shiftDate: Date): boolean {
  const now = new Date();

  const startOfTodayUtc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );

  const shiftDayUtc = new Date(
    Date.UTC(
      shiftDate.getUTCFullYear(),
      shiftDate.getUTCMonth(),
      shiftDate.getUTCDate()
    )
  );

  return shiftDayUtc < startOfTodayUtc;
}

function absoluteLink(pathOrUrl: string): string {
  const base = (APP_BASE_URL.value() || "").trim().replace(/\/+$/, "");
  if (!base) return pathOrUrl; // fallback
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
    return pathOrUrl;
  }
  const path = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
  return `${base}${path}`;
}

// Central place to send users when action is required
function pendingGateUrl(): string {
  return "/dashboard?gate=pending";
}

/**
 * Check user-level preference switch.
 * If users/{uid}.notificationsEnabled === false => do not send.
 */
async function isUserNotificationsEnabled(userId: string): Promise<boolean> {
  const userDoc = await db.collection("users").doc(userId).get();
  if (!userDoc.exists) return true; // default allow
  const enabled = (userDoc.data() as any)?.notificationsEnabled;
  return enabled !== false;
}

async function sendFcmToUser(
  userId: string,
  title: string,
  body: string,
  urlPath: string,
  data: Record<string, string> = {}
) {
  if (!userId) return;

  // Global kill switch
  const settingsDoc = await db.collection("settings").doc("notifications").get();
  if (settingsDoc.exists && (settingsDoc.data() as any)?.enabled === false) {
    logger.log("Global notifications disabled; skipping send", { userId });
    return;
  }

  // User-level switch
  const userEnabled = await isUserNotificationsEnabled(userId);
  if (!userEnabled) {
    logger.log("User notifications disabled; skipping send", { userId });
    return;
  }

  const tokens = await getUserFcmTokens(userId);
  if (!tokens.length) {
    logger.info("No FCM tokens for user; cannot send", { userId });
    return;
  }

  const link = absoluteLink(urlPath);

  // DATA-ONLY payload (service worker handles notification display)
  const message = {
    tokens,
    data: {
      title,
      body,
      url: link,
      ...Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)])
      ),
    },
    webpush: {
      headers: { Urgency: "high" },
      fcmOptions: { link },
    },
    apns: {
      payload: { aps: { sound: "default" } },
    },
  };

  const resp = await admin.messaging().sendEachForMulticast(message as any);

  const invalid: string[] = [];
  resp.responses.forEach((r, idx) => {
    if (!r.success) {
      const code = (r.error as any)?.code || "";
      if (
        code.includes("registration-token-not-registered") ||
        code.includes("invalid-argument") ||
        code.includes("invalid-registration-token")
      ) {
        invalid.push(tokens[idx]);
      }
      logger.error("FCM send failed", {
        userId,
        code,
        msg: (r.error as any)?.message,
      });
    }
  });

  if (invalid.length) await pruneInvalidTokens(userId, invalid);

  logger.log("FCM send complete", {
    userId,
    tokens: tokens.length,
    success: resp.successCount,
    failure: resp.failureCount,
  });
}

// --------------------
// Firestore triggers: shifts/{shiftId}
// --------------------

export const onShiftCreated = onDocumentCreated(
  { document: "shifts/{shiftId}", region: europeWest2 },
  async (event) => {
    const shift = event.data?.data() as any;
    if (!shift) return;

    const userId = shift.userId;
    if (!userId) {
      logger.log("Shift created without userId; no notify", {
        shiftId: event.params.shiftId,
      });
      return;
    }

    const shiftDate = shift.date?.toDate?.() ? shift.date.toDate() : null;
    if (!shiftDate) return;

    // Only today/future
    if (isShiftInPast(shiftDate)) {
      logger.log("Shift created in past; no notify", {
        shiftId: event.params.shiftId,
      });
      return;
    }

    const shiftId = event.params.shiftId;

    await sendFcmToUser(
      userId,
      "New shift added",
      `A new shift was added for ${formatDateUK(shiftDate)}`,
      pendingGateUrl(),
      { shiftId, gate: "pending", event: "created" }
    );
  }
);

export const onShiftUpdated = onDocumentUpdated(
  { document: "shifts/{shiftId}", region: europeWest2 },
  async (event) => {
    const before = event.data?.before.data() as any;
    const after = event.data?.after.data() as any;
    if (!before || !after) return;

    const shiftId = event.params.shiftId;

    // 1) reassignment
    if (before.userId !== after.userId) {
      if (before.userId) {
        const d = before.date?.toDate?.() ? before.date.toDate() : null;
        await sendFcmToUser(
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
        const d = after.date?.toDate?.() ? after.date.toDate() : null;
        if (d && !isShiftInPast(d)) {
          await sendFcmToUser(
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
      return;
    }

    // 2) meaningful change for same user
    const userId = after.userId;
    if (!userId) return;

    const afterDate = after.date?.toDate?.() ? after.date.toDate() : null;
    if (!afterDate) return;

    // Only today/future
    if (isShiftInPast(afterDate)) {
      logger.log("Shift updated but in past; no notify", { shiftId });
      return;
    }

    // If the shift owner updated their OWN shift, do NOT notify them about their own action.
    const updatedByUid = String(after.updatedByUid || "").trim();
    if (updatedByUid && updatedByUid === String(userId)) {
      logger.log("Shift updated by assigned user; skipping notify", {
        shiftId,
        userId,
        updatedByUid,
        updatedByAction: String(after.updatedByAction || ""),
        statusBefore: String(before.status || ""),
        statusAfter: String(after.status || ""),
      });
      return;
    }

    // Only notify when meaningful fields change
    const fieldsToCompare = [
      "task",
      "address",
      "type",
      "notes",
      "status",
      "date",
    ] as const;

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

    const needsAction =
      String(after.status || "").toLowerCase() === "pending-confirmation";

    await sendFcmToUser(
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
  }
);

export const onShiftDeleted = onDocumentDeleted(
  { document: "shifts/{shiftId}", region: europeWest2 },
  async (event) => {
    const deleted = event.data?.data() as any;
    if (!deleted) return;

    const userId = deleted.userId;
    if (!userId) return;

    const d = deleted.date?.toDate?.() ? deleted.date.toDate() : null;

    const status = String(deleted.status || "").toLowerCase();
    const FINAL_STATUSES = new Set(["completed", "incomplete", "rejected"]);

    // Never notify for history/final shifts
    if (FINAL_STATUSES.has(status)) {
      logger.log("Shift deleted but was historical; no notify", {
        shiftId: event.params.shiftId,
        status,
      });
      return;
    }

    // Never notify for past/expired shifts
    if (d && isShiftInPast(d)) {
      logger.log("Shift deleted but in past; no notify", {
        shiftId: event.params.shiftId,
      });
      return;
    }

    // Fail-safe: if no date, skip notification
    if (!d) {
      logger.log("Shift deleted but no date; skipping notify", {
        shiftId: event.params.shiftId,
      });
      return;
    }

    await sendFcmToUser(
      userId,
      "Shift removed",
      `Your shift for ${formatDateUK(d)} has been removed.`,
      "/dashboard",
      { shiftId: event.params.shiftId, event: "deleted" }
    );
  }
);

// --------------------
// Callables
// --------------------

export const getNotificationStatusV2 = onCall(
  { region: europeWest2 },
  async (req) => {
    const docSnap = await db.collection("settings").doc("notifications").get();
    const enabled = docSnap.exists ? (docSnap.data() as any)?.enabled !== false : true;

    const uid = req.auth?.uid || "";
    if (!uid) return { enabled, hasToken: false, tokenCount: 0 };

    const userEnabled = await isUserNotificationsEnabled(uid);
    const tokens = await getUserFcmTokens(uid);

    return {
      enabled,
      userEnabled,
      hasToken: tokens.length > 0,
      tokenCount: tokens.length,
    };
  }
);

export const setNotificationStatusV2 = onCall(
  { region: europeWest2 },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) {
      logger.info("setNotificationStatus: UNAUTHENTICATED");
      throw new Error("Unauthenticated");
    }

    const enabled = !!(req.data as any)?.enabled;
    const tokenRaw = (req.data as any)?.token;
    const token = typeof tokenRaw === "string" ? tokenRaw.trim() : "";
    const platformRaw = (req.data as any)?.platform;
    const platform = typeof platformRaw === "string" ? platformRaw.trim() : null;

    logger.info("setNotificationStatus: ENTER", {
      uid,
      enabled,
      tokenPresent: !!token,
      tokenLen: token.length,
      keys: req.data ? Object.keys(req.data) : [],
      ua: req.rawRequest?.headers?.["user-agent"] || null,
      platform,
    });

    // Store user-level enabled switch
    await db.collection("users").doc(uid).set(
      {
        notificationsEnabled: enabled,
        notificationsUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    const col = db.collection("users").doc(uid).collection("pushTokens");

    if (enabled) {
      if (!token) {
        logger.info("setNotificationStatus: MISSING TOKEN", {
          uid,
          keys: req.data ? Object.keys(req.data) : [],
        });
        throw new Error("Missing token");
      }

      await col.doc(token).set(
        {
          token,
          platform,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          userAgent:
            (req.rawRequest?.headers?.["user-agent"] as string | undefined) ||
            null,
        },
        { merge: true }
      );

      logger.info("setNotificationStatus: SAVED TOKEN", {
        uid,
        tokenLen: token.length,
      });

      return { success: true, enabled: true, debug: { tokenLen: token.length } };
    }

    // enabled=false => remove one token (if provided) or all
    if (token) {
      await col.doc(token).delete().catch(() => {});
      logger.info("setNotificationStatus: DELETED ONE TOKEN", {
        uid,
        tokenLen: token.length,
      });
    } else {
      const snap = await col.get();
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      logger.info("setNotificationStatus: DELETED ALL TOKENS", {
        uid,
        count: snap.size,
      });
    }

    return { success: true, enabled: false, debug: { tokenProvided: !!token } };
  }
);

// --------------------
// Schedulers (kept)
// --------------------

export const projectReviewNotifier = onSchedule(
  { schedule: "every 24 hours", region: europeWest2 },
  () => {
    logger.log("projectReviewNotifier executed.");
  }
);

export const pendingShiftNotifier = onSchedule(
  { schedule: "every 1 hours", region: europeWest2 },
  () => {
    logger.log("pendingShiftNotifier executed.");
  }
);