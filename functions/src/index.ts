import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as webPush from "web-push";
import axios from "axios";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();

/* =====================================================
   PUSH ENV
===================================================== */

const VAPID_PUBLIC = process.env.WEBPUSH_PUBLIC_KEY || "";
const VAPID_PRIVATE = process.env.WEBPUSH_PRIVATE_KEY || "";
const VAPID_SUBJECT =
  process.env.WEBPUSH_SUBJECT || "mailto:example@your-project.com";

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

/* =====================================================
   PUSH HELPER
===================================================== */

async function sendWebPushToUser(uid: string, payload: any) {
  const snap = await db.collection(`users/${uid}/pushSubscriptions`).get();
  if (snap.empty) return;

  for (const docSnap of snap.docs) {
    const sub = docSnap.data()?.subscription;
    if (!sub) continue;

    try {
      await webPush.sendNotification(sub, JSON.stringify(payload));
    } catch (err) {
      logger.error("Push failed, removing subscription", err);
      await docSnap.ref.delete();
    }
  }
}

/* =====================================================
   SHIFT TRIGGER
===================================================== */

export const onShiftWrite = onDocumentWritten(
  { region: "europe-west2", document: "shifts/{shiftId}" },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();

    const doc: any = after || before;
    if (!doc?.userId) return;

    const isCreate = !before && !!after;
    const isDelete = !!before && !after;

    if (isDelete) {
      await sendWebPushToUser(doc.userId, {
        title: "Shift Cancelled",
        body: "A shift has been cancelled.",
        url: "/dashboard",
      });
      return;
    }

    await sendWebPushToUser(doc.userId, {
      title: isCreate ? "New Shift Assigned" : "Shift Updated",
      body: isCreate
        ? "You have been assigned a new shift."
        : "One of your shifts has been updated.",
      url: "/dashboard",
    });
  }
);

/* =====================================================
   DELETE ALL SHIFTS
===================================================== */

export const deleteAllShifts = onCall(
  { region: "europe-west2" },
  async (req) => {
    if (!req.auth) {
      throw new HttpsError("unauthenticated", "Login required");
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

    return { ok: true, deleted: totalDeleted };
  }
);

/* =====================================================
   AI MERCHANT FINDER (NEW PLACES API)
===================================================== */

/* =====================================================
   AI MERCHANT FINDER (Places API NEW + GPS Bias)
===================================================== */

export const aiMerchantFinder = onCall(
  {
    region: "europe-west2",
    timeoutSeconds: 30,
    secrets: ["GOOGLE_PLACES_KEY"],
  },
  async (req) => {
    if (!req.auth) {
      throw new HttpsError("unauthenticated", "Login required");
    }

    const { message, lat, lng } = req.data;

    if (!message || !lat || !lng) {
      throw new HttpsError(
        "invalid-argument",
        "Message and GPS coordinates required"
      );
    }

    try {
      const response = await axios.post(
        "https://places.googleapis.com/v1/places:searchText",
        {
          textQuery: message,
          maxResultCount: 5,
          locationBias: {
            circle: {
              center: {
                latitude: lat,
                longitude: lng,
              },
              radius: 5000.0,
            },
          },
        },
        {
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": process.env.GOOGLE_PLACES_KEY,
            "X-Goog-FieldMask":
              "places.displayName,places.formattedAddress,places.rating,places.googleMapsUri",
          },
        }
      );

      const results =
        response.data.places?.map((place: any) => ({
          name: place.displayName?.text,
          rating: place.rating || null,
          address: place.formattedAddress,
          mapsUrl: place.googleMapsUri,
        })) || [];

      return { results };
    } catch (err: any) {
      logger.error("Places API error:", err?.response?.data || err);
      throw new HttpsError("internal", "Failed to fetch merchants");
    }
  }
);

/* =====================================================
   CLEANUP SCHEDULE
===================================================== */

export const cleanupDeletedProjects = onSchedule(
  {
    schedule: "every 24 hours",
    region: "europe-west2",
  },
  async () => {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const snapshot = await db
      .collection("projects")
      .where(
        "deletionScheduledAt",
        "<=",
        admin.firestore.Timestamp.fromDate(sevenDaysAgo)
      )
      .get();

    if (snapshot.empty) return;

    const bucket = admin.storage().bucket();

    for (const doc of snapshot.docs) {
      const projectId = doc.id;

      try {
        await bucket.deleteFiles({
          prefix: `project_files/${projectId}/`,
        });
      } catch {
        logger.warn(
          `No storage files found for project ${projectId}`
        );
      }

      await doc.ref.delete();
    }
  }
);

/* =====================================================
   FILE SERVE EXPORT
===================================================== */

export { serveFile } from "./files";
