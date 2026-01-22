import { onCall } from "firebase-functions/v2/https";
import {
  onDocumentCreated,
  onDocumentDeleted,
  onDocumentUpdated,
} from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";
import { defineString } from "firebase-functions/params";
import admin from "firebase-admin";

// --- Admin init ---
if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

// --- Config / secrets ---
// This is used so notification clicks open your real domain, not relative paths.
// Set it to your live site, e.g. https://yourapp.web.app
const APP_BASE_URL = defineString("APP_BASE_URL");

// Optional global kill switch doc: settings/notifications { enabled: true/false }
const europeWest2 = "europe-west2";

/**
 * Firestore path where we store FCM tokens:
 * users/{uid}/pushTokens/{tokenDocId}
 * { token: string, updatedAt: string, userAgent?: string }
 */
async function getUserFcmTokens(userId: string): Promise<string[]> {
  const snap = await db
    .collection("users")
    .doc(userId)
    .collection("pushTokens")
    .get();

  if (snap.empty) return [];

  const tokens: string[] = [];
  for (const doc of snap.docs) {
    const data = doc.data() as any;
    const t = (data.token || data.fcmToken || doc.id || "")
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
 * We compare by UTC day to avoid timezone drift and libraries.
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
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://"))
    return pathOrUrl;
  const path = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
  return `${base}${path}`;
}

async function sendFcmToUser(
  userId: string,
  title: string,
  body: string,
  urlPath: string,
  data: Record<string, string> = {}
) {
  if (!userId) return;

  // global kill switch
  const settingsDoc = await db.collection("settings").doc("notifications").get();
  if (settingsDoc.exists && settingsDoc.data()?.enabled === false) {
    logger.log("Global notifications disabled; skipping send", { userId });
    return;
  }

  const tokens = await getUserFcmTokens(userId);
  if (!tokens.length) {
    logger.warn("No FCM tokens for user; cannot send", { userId });
    return;
  }

  const link = absoluteLink(urlPath);

  // NOTE: For web push, best reliability comes from "webpush.fcmOptions.link"
  const message = {
    tokens,
    notification: { title, body },
    data: {
      url: link, // keep full url in data too (handy for SW)
      ...Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)])
      ),
    },
    webpush: {
      fcmOptions: { link }, // click opens this
      notification: {
        // optional web-only fields
        icon: "/icons/icon-192x192.png",
      },
    },
  };

  const resp = await admin.messaging().sendEachForMulticast(message as any);

  const invalid: string[] = [];
  resp.responses.forEach((r, idx) => {
    if (!r.success) {
      const code = (r.error as any)?.code || "";
      // token issues
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

// --- Firestore triggers: shifts/{shiftId} ---

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

    if (isShiftInPast(shiftDate)) {
      logger.log("Shift created in past; no notify", {
        shiftId: event.params.shiftId,
      });
      return;
    }

    await sendFcmToUser(
      userId,
      "New shift added",
      `A new shift was added for ${formatDateUK(shiftDate)}`,
      `/shift/${event.params.shiftId}`,
      { shiftId: event.params.shiftId }
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
          { shiftId }
        );
      }

      if (after.userId) {
        const d = after.date?.toDate?.() ? after.date.toDate() : null;
        if (d && !isShiftInPast(d)) {
          await sendFcmToUser(
            after.userId,
            "New shift added",
            `A new shift was added for ${formatDateUK(d)}`,
            `/shift/${shiftId}`,
            { shiftId }
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

    if (isShiftInPast(afterDate)) {
      logger.log("Shift updated but in past; no notify", { shiftId });
      return;
    }

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

    await sendFcmToUser(
      userId,
      "Shift updated",
      `Your shift for ${formatDateUK(afterDate)} has been updated.`,
      `/shift/${shiftId}`,
      { shiftId }
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

    await sendFcmToUser(
      userId,
      "Shift removed",
      d
        ? `Your shift for ${formatDateUK(d)} has been removed.`
        : "A shift has been removed.",
      "/dashboard",
      { shiftId: event.params.shiftId }
    );
  }
);

// --- Optional callables (safe) ---

export const getNotificationStatus = onCall(
  { region: europeWest2 },
  async () => {
    const doc = await db.collection("settings").doc("notifications").get();
    const enabled = doc.exists ? doc.data()?.enabled !== false : true;
    return { enabled };
  }
);

export const setNotificationStatus = onCall(
  { region: europeWest2 },
  async (req) => {
    // IMPORTANT: you should lock this down by auth/role. Stub for now.
    const enabled = !!(req.data as any)?.enabled;
    await db
      .collection("settings")
      .doc("notifications")
      .set({ enabled }, { merge: true });
    return { success: true, enabled };
  }
);

// schedulers kept
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
