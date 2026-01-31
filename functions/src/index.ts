import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { onCall, HttpsError, onRequest } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import * as webPush from "web-push";

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

export const getVapidPublicKey = onCall(
  { region: "europe-west2" },
  async () => {
    if (!VAPID_PUBLIC) {
      throw new HttpsError(
        "failed-precondition",
        "VAPID public key is not configured"
      );
    }
    return { publicKey: VAPID_PUBLIC };
  }
);

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

    const subs = db
      .collection("users")
      .doc(uid)
      .collection("pushSubscriptions");

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

// HTTP test endpoint (no Eventarc)
export const sendTestNotificationHttp = onRequest(
  { region: "europe-west2" },
  async (req, res) => {
    try {
      const uid = String(req.query.uid || "");

      if (!uid) {
        res.status(400).json({ ok: false, error: "Missing uid" });
        return;
      }

      if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
        res
          .status(500)
          .json({ ok: false, error: "VAPID keys not configured" });
        return;
      }

      const snap = await db
        .collection(`users/${uid}/pushSubscriptions`)
        .get();

      if (snap.empty) {
        res.json({ ok: true, sent: 0, removed: 0 });
        return;
      }

      const payload = JSON.stringify({
        title: "Test Notification",
        body: "Push is working",
        url: "/",
      });

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

      res.json({ ok: true, sent, removed });
    } catch (e: any) {
      res
        .status(500)
        .json({ ok: false, error: e?.message || String(e) });
    }
  }
);

export const onShiftWrite = onDocumentWritten(
  { region: "europe-west2", document: "shifts/{shiftId}" },
  async () => undefined
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
