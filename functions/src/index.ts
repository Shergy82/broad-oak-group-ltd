// functions/src/index.ts
import * as admin from "firebase-admin";
import cors from "cors";
import * as webPush from "web-push";

import { onRequest } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const europeWest2 = "europe-west2";
const corsHandler = cors({ origin: true });

// ----------------------------
// setNotificationStatus (HTTP)
// Auth: Authorization: Bearer <Firebase ID token>
// Body: { enabled: boolean, subscription?: { endpoint, keys } }
// ALSO accepts callable-style body: { data: { enabled, subscription } }
// Stores subs at: users/{uid}/pushSubscriptions/{urlSafeBase64(endpoint)}
// ----------------------------
export const setNotificationStatus = onRequest({ region: europeWest2 }, (req, res) => {
  return corsHandler(req, res, async () => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    try {
      // ---- Auth ----
      const auth = req.get("Authorization") || "";
      const m = auth.match(/^Bearer\s+(.+)$/i);
      if (!m) {
        res.status(401).json({ data: null, error: "Missing Authorization: Bearer <token>" });
        return;
      }

      const decoded = await admin.auth().verifyIdToken(m[1]);
      const uid = decoded.uid;

      // ---- Body ----
      // Support BOTH:
      //   HTTP style:      { enabled, subscription }
      //   Callable style:  { data: { enabled, subscription } }
      const body = (req.body && typeof req.body === "object") ? req.body : {};
      const payload = (body.data && typeof body.data === "object") ? body.data : body;

      const enabledRaw = (payload as any).enabled;
      if (typeof enabledRaw !== "boolean") {
        res.status(400).json({ data: null, error: "Body must include { enabled: boolean }" });
        return;
      }
      const enabled = enabledRaw as boolean;
      const subscription = (payload as any).subscription;

      const subsRef = db.collection("users").doc(uid).collection("pushSubscriptions");

      if (enabled) {
        if (!subscription || !subscription.endpoint || !subscription.keys) {
          res.status(400).json({ data: null, error: "Valid subscription is required." });
          return;
        }

        // URL-safe doc id (avoids '/' '+' '=' issues in doc IDs)
        const docId = Buffer.from(String(subscription.endpoint))
          .toString("base64")
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/g, "");

        await subsRef.doc(docId).set(
          {
            endpoint: subscription.endpoint,
            keys: subscription.keys,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        // IMPORTANT: frontend expects { data: ... }
        res.json({ data: { success: true, enabled: true } });
        return;
      }

      // enabled === false -> delete all subs for user
      const snap = await subsRef.get();
      if (!snap.empty) {
        const batch = db.batch();
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }

      res.json({ data: { success: true, enabled: false } });
    } catch (e: any) {
      res.status(400).json({ data: null, error: e?.message || "Unknown error" });
    }
  });
});

// ----------------------------
// onShiftWrite -> send Web Push
// Requires env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY
// ----------------------------
export const onShiftWrite = onDocumentWritten(
  { document: "shifts/{shiftId}", region: europeWest2 },
  async (event) => {
    const settingsDoc = await db.collection("settings").doc("notifications").get();
    if (settingsDoc.exists && settingsDoc.data()?.enabled === false) return;

    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    if (!publicKey || !privateKey) {
      console.error("Missing VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY");
      return;
    }

    webPush.setVapidDetails("mailto:notifications@broadoakgroup.com", publicKey, privateKey);

    const beforeData = event.data?.before.data();
    const afterData = event.data?.after.data();

    let userId: string | null = null;
    let payload: any | null = null;

    if (event.data?.after.exists && !event.data?.before.exists) {
      userId = afterData?.userId || null;
      payload = {
        title: "New Shift Assigned",
        body: `You have a new shift: ${afterData?.task} at ${afterData?.address}.`,
        data: { url: "/dashboard" },
      };
    } else if (!event.data?.after.exists && event.data?.before.exists) {
      userId = beforeData?.userId || null;
      payload = {
        title: "Shift Cancelled",
        body: `Your shift for ${beforeData?.task} at ${beforeData?.address} has been cancelled.`,
        data: { url: "/dashboard" },
      };
    } else if (event.data?.after.exists && event.data?.before.exists) {
      const changed =
        beforeData?.task !== afterData?.task ||
        beforeData?.address !== afterData?.address ||
        (beforeData?.date && afterData?.date && !beforeData.date.isEqual(afterData.date));

      if (changed) {
        userId = afterData?.userId || null;
        payload = {
          title: "Your Shift Has Been Updated",
          body: "The details for one of your shifts have changed.",
          data: { url: "/dashboard" },
        };
      }
    }

    if (!userId || !payload) return;

    const subsSnap = await db.collection("users").doc(userId).collection("pushSubscriptions").get();
    if (subsSnap.empty) return;

    await Promise.all(
      subsSnap.docs.map(async (d) => {
        const sub = d.data() as any;
        try {
          await webPush.sendNotification(
            { endpoint: sub.endpoint, keys: sub.keys },
            JSON.stringify(payload)
          );
        } catch (err: any) {
          const code = err?.statusCode;
          if (code === 404 || code === 410) {
            await d.ref.delete(); // prune dead subscription
          } else {
            console.error("web-push send failed:", err);
          }
        }
      })
    );
  }
);
