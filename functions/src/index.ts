/* =====================================================
   IMPORTS
===================================================== */

import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } from "firebase-functions/v2/firestore";
import { onSchedule, ScheduledEvent } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";
import type { Request, Response } from "express";
import JSZip from "jszip";
import * as webPush from "web-push";

/* =====================================================
   CONSTANTS
===================================================== */

const REGION = "europe-west2";

/* =====================================================
   BOOTSTRAP
===================================================== */

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();

/* =====================================================
   ENV
===================================================== */

const WEBPUSH_PUBLIC_KEY = process.env.WEBPUSH_PUBLIC_KEY ?? "";
const WEBPUSH_PRIVATE_KEY = process.env.WEBPUSH_PRIVATE_KEY ?? "";
const GEOCODING_KEY = process.env.GOOGLE_GEOCODING_KEY ?? "";

/* =====================================================
   VAPID CONFIG
===================================================== */

if (WEBPUSH_PUBLIC_KEY && WEBPUSH_PRIVATE_KEY) {
  try {
    webPush.setVapidDetails(
      "mailto:example@yourdomain.org",
      WEBPUSH_PUBLIC_KEY,
      WEBPUSH_PRIVATE_KEY
    );
  } catch (err) {
    logger.error("Failed to configure VAPID", err);
  }
} else {
  logger.warn("VAPID keys missing – push notifications disabled");
}

/* =====================================================
   HELPERS
===================================================== */

const assertAuthenticated = (uid?: string) => {
  if (!uid) throw new HttpsError("unauthenticated", "Authentication required");
};

const assertIsOwner = async (uid?: string) => {
  assertAuthenticated(uid);
  const snap = await db.collection("users").doc(uid!).get();
  if (snap.data()?.role !== "owner") {
    throw new HttpsError("permission-denied", "Owner role required");
  }
};

const assertAdminOrManager = async (uid: string) => {
  const snap = await db.collection("users").doc(uid).get();
  if (!["admin", "owner", "manager"].includes(snap.data()?.role)) {
    throw new HttpsError("permission-denied", "Insufficient permissions");
  }
};

const formatDateUK = (d: Date): string =>
  `${String(d.getUTCDate()).padStart(2, "0")}/${String(
    d.getUTCMonth() + 1
  ).padStart(2, "0")}/${d.getUTCFullYear()}`;

const isShiftInPast = (d: Date): boolean => {
  const now = new Date();
  const todayUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  );
  const shiftUtc = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate()
  );
  return shiftUtc < todayUtc;
};

const pendingGateUrl = () => "/dashboard?gate=pending";

/* =====================================================
   NOTIFICATIONS
===================================================== */

async function sendShiftNotification(
  userId: string,
  title: string,
  body: string,
  url: string,
  data: Record<string, any> = {}
): Promise<void> {
  if (!userId || !WEBPUSH_PUBLIC_KEY || !WEBPUSH_PRIVATE_KEY) return;

  const userDoc = await db.collection("users").doc(userId).get();
  if (userDoc.data()?.notificationsEnabled === false) return;

  const subs = await db
    .collection("users")
    .doc(userId)
    .collection("pushSubscriptions")
    .get();

  if (subs.empty) return;

  const payload = JSON.stringify({
    title,
    body,
    data: { url, ...data },
  });

  await Promise.all(
    subs.docs.map(async (doc) => {
      try {
        await webPush.sendNotification(
          doc.data() as webPush.PushSubscription,
          payload
        );
      } catch (err: any) {
        if ([404, 410].includes(err?.statusCode)) {
          await doc.ref.delete().catch(() => {});
        }
      }
    })
  );
}

/* =====================================================
   CALLABLE FUNCTIONS
===================================================== */

export const getNotificationStatus = onCall({ region: REGION }, async (req) => {
  assertAuthenticated(req.auth?.uid);
  const snap = await db.collection("users").doc(req.auth!.uid).get();
  return { enabled: snap.data()?.notificationsEnabled ?? false };
});

export const setNotificationStatus = onCall({ region: REGION }, async (req) => {
  assertAuthenticated(req.auth?.uid);
  const { enabled, subscription } = req.data ?? {};

  if (typeof enabled !== "boolean") {
    throw new HttpsError("invalid-argument", "enabled must be boolean");
  }

  await db
    .collection("users")
    .doc(req.auth!.uid)
    .set({ notificationsEnabled: enabled }, { merge: true });

  if (enabled && subscription) {
    await db
      .collection("users")
      .doc(req.auth!.uid)
      .collection("pushSubscriptions")
      .doc("browser")
      .set(subscription, { merge: true });
  }

  return { success: true };
});

/* =====================================================
   HTTP FILE SERVE
===================================================== */

export const serveFile = onRequest(
  { region: REGION, cors: true },
  async (req: Request, res: Response): Promise<void> => {
    const path = req.query.path as string;

    if (!path) {
      res.status(400).send("Missing path");
      return;
    }

    const file = admin.storage().bucket().file(path);
    const [exists] = await file.exists();

    if (!exists) {
      res.status(404).send("Not found");
      return;
    }

    file.createReadStream().pipe(res);
  }
);

/* =====================================================
   FIRESTORE TRIGGERS
===================================================== */

export const onShiftCreated = onDocumentCreated(
  { document: "shifts/{shiftId}", region: REGION },
  async (event) => {
    const shift = event.data?.data();
    if (!shift?.userId) return;

    const date = shift.date?.toDate?.();
    if (!date || isShiftInPast(date)) return;

    await sendShiftNotification(
      shift.userId,
      "New shift added",
      `A new shift was added for ${formatDateUK(date)}`,
      pendingGateUrl(),
      { shiftId: event.params.shiftId }
    );
  }
);

/* =====================================================
   SCHEDULED FUNCTIONS (FIXED)
===================================================== */

export const projectReviewNotifier = onSchedule(
  { schedule: "every 24 hours", region: REGION },
  async (event: ScheduledEvent): Promise<void> => {
    logger.info("projectReviewNotifier ran", {
      scheduleTime: event.scheduleTime,
    });
  }
);

export const pendingShiftNotifier = onSchedule(
  { schedule: "every 1 hours", region: REGION },
  async (event: ScheduledEvent): Promise<void> => {
    logger.info("pendingShiftNotifier ran", {
      scheduleTime: event.scheduleTime,
    });
  }
);

export const deleteScheduledProjects = onSchedule(
  {
    schedule: "every day 01:00",
    region: REGION,
    timeoutSeconds: 540,
    memory: "256MiB",
  },
  async (event: ScheduledEvent): Promise<void> => {
    logger.info("Scheduled project cleanup started", {
      scheduleTime: event.scheduleTime,
    });

    // TODO: deletion logic here

    logger.info("Scheduled project cleanup finished");
  }
);