import { onCall } from "firebase-functions/v2/https";
import { onDocumentCreated, onDocumentDeleted, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";
import { defineString } from "firebase-functions/params";
import admin from "firebase-admin";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const europeWest2 = "europe-west2";

// Set this to your hosted app URL (NO trailing slash) at deploy time
const APP_BASE_URL = defineString("APP_BASE_URL");
// https://broad-oak-group-ltd--the-final-project-5e248.europe-west4.hosted.app

function isShiftInPast(shiftDate: Date): boolean {
  // Consider "past" as any date before today (UTC) — avoids timezone libs entirely
  const now = new Date();
  const startOfTodayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const shiftDayUtc = new Date(Date.UTC(shiftDate.getUTCFullYear(), shiftDate.getUTCMonth(), shiftDate.getUTCDate()));
  return shiftDayUtc < startOfTodayUtc;
}

function absUrl(path: string) {
  const base = (APP_BASE_URL.value() || "").trim().replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return base ? `${base}${p}` : p;
}

async function globalNotificationsEnabled(): Promise<boolean> {
  const doc = await db.collection("settings").doc("notifications").get();
  if (!doc.exists) return true;
  return Boolean(doc.data()?.enabled) !== false;
}

async function sendFcmToUser(userId: string, title: string, body: string, urlPath: string) {
  if (!userId) return;

  if (!(await globalNotificationsEnabled())) {
    logger.log("Global notifications disabled. Skipping.", { userId });
    return;
  }

  // Your client stores tokens here: users/{uid}/pushSubscriptions/{token}
  const snap = await db.collection("users").doc(userId).collection("pushSubscriptions").get();
  if (snap.empty) {
    logger.warn("No push subscriptions for user", { userId });
    return;
  }

  const tokens = snap.docs
    .map((d) => (d.get("fcmToken") as string) || d.id) // matches your client
    .filter(Boolean) as string[];

  if (!tokens.length) {
    logger.warn("Push subscriptions exist but no tokens found", { userId });
    return;
  }

  const res = await admin.messaging().sendEachForMulticast({
    tokens,
    notification: { title, body },
    data: {
      url: absUrl(urlPath),
    },
  });

  // Clean invalid tokens (doc id == token in your client, so deleting by token works)
  const invalid: string[] = [];
  res.responses.forEach((r, idx) => {
    if (!r.success) {
      const code = (r.error as any)?.code || "";
      if (code.includes("registration-token-not-registered") || code.includes("invalid-argument")) {
        invalid.push(tokens[idx]);
      } else {
        logger.error("FCM send error", { userId, token: tokens[idx], error: r.error });
      }
    }
  });

  if (invalid.length) {
    await Promise.all(
      invalid.map(async (t) => {
        await db.collection("users").doc(userId).collection("pushSubscriptions").doc(t).delete().catch(() => {});
      })
    );
    logger.log("Pruned invalid tokens", { userId, count: invalid.length });
  }
}

// ---- Shift triggers ----

export const onShiftCreated = onDocumentCreated(
  { document: "shifts/{shiftId}", region: europeWest2 },
  async (event) => {
    const shift = event.data?.data();
    if (!shift) return;

    const userId = shift.userId as string | undefined;
    if (!userId) return;

    const shiftDate = shift.date?.toDate?.();
    if (!shiftDate) {
      logger.warn("Shift created with invalid date", { shiftId: event.params.shiftId });
      return;
    }

    if (isShiftInPast(shiftDate)) return;

    await sendFcmToUser(
      userId,
      "New shift added",
      "A new shift has been assigned to you.",
      `/shift/${event.params.shiftId}`
    );
  }
);

export const onShiftUpdated = onDocumentUpdated(
  { document: "shifts/{shiftId}", region: europeWest2 },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;

    const shiftId = event.params.shiftId;

    // Reassignment logic
    if (before.userId !== after.userId) {
      if (before.userId) {
        await sendFcmToUser(
          before.userId,
          "Shift removed",
          "A shift has been unassigned from you.",
          `/dashboard`
        );
      }
      const afterDate = after.date?.toDate?.();
      if (after.userId && afterDate && !isShiftInPast(afterDate)) {
        await sendFcmToUser(
          after.userId,
          "New shift added",
          "A new shift has been assigned to you.",
          `/shift/${shiftId}`
        );
      }
      return;
    }

    const userId = after.userId as string | undefined;
    if (!userId) return;

    const afterDate = after.date?.toDate?.();
    if (!afterDate) return;
    if (isShiftInPast(afterDate)) return;

    // Only notify on meaningful changes
    const fields = ["task", "address", "type", "notes", "status", "eNumber"] as const;

    const changed =
      fields.some((f) => (before[f] ?? "") !== (after[f] ?? "")) ||
      (before.date && after.date && !before.date.isEqual(after.date));

    if (!changed) return;

    await sendFcmToUser(
      userId,
      "Shift updated",
      "One of your shifts has been updated.",
      `/shift/${shiftId}`
    );
  }
);

export const onShiftDeleted = onDocumentDeleted(
  { document: "shifts/{shiftId}", region: europeWest2 },
  async (event) => {
    const before = event.data?.data();
    if (!before) return;

    const userId = before.userId as string | undefined;
    if (!userId) return;

    await sendFcmToUser(
      userId,
      "Shift removed",
      "One of your shifts has been removed.",
      `/dashboard`
    );
  }
);

// ---- Callables / Schedulers (keep simple stubs) ----
export const getNotificationStatus = onCall({ region: europeWest2 }, async () => ({ enabled: true }));
export const setNotificationStatus = onCall({ region: europeWest2 }, async () => ({ success: true }));

export const projectReviewNotifier = onSchedule({ schedule: "every 24 hours", region: europeWest2 }, async () => {
  logger.log("projectReviewNotifier executed.");
});

export const pendingShiftNotifier = onSchedule({ schedule: "every 1 hours", region: europeWest2 }, async () => {
  logger.log("pendingShiftNotifier executed.");
});
