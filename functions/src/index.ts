import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import * as webPush from "web-push";

if (admin.apps.length === 0) admin.initializeApp();
const db = admin.firestore();

const VAPID_PUBLIC = process.env.WEBPUSH_PUBLIC_KEY || "";
const VAPID_PRIVATE = process.env.WEBPUSH_PRIVATE_KEY || "";
const VAPID_SUBJECT = process.env.WEBPUSH_SUBJECT || "mailto:example@your-project.com";

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
} else {
  logger.warn("VAPID keys not configured. Push notifications will not work.");
}

function subIdFromEndpoint(endpoint: string) {
  return Buffer.from(endpoint).toString("base64").replace(/=+$/g, "");
}

export const getVapidPublicKey = onCall({ region: "europe-west2" }, async () => {
  if (!VAPID_PUBLIC) {
    throw new HttpsError("failed-precondition", "VAPID public key is not configured on the server.");
  }
  return { publicKey: VAPID_PUBLIC };
});

export const setNotificationStatus = onCall({ region: "europe-west2" }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "User must be authenticated.");

  const uid = req.auth.uid;
  const data = req.data as any;
  const status = data?.status;
  const subscription = data?.subscription;
  const endpoint = data?.endpoint;

  const subsCollection = db.collection("users").doc(uid).collection("pushSubscriptions");

  if (status === "subscribed") {
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      throw new HttpsError("invalid-argument", "A valid subscription object is required.");
    }
    const id = subIdFromEndpoint(subscription.endpoint);
    await subsCollection.doc(id).set(
      {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth
        },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    return { ok: true };
  }

  if (status === "unsubscribed") {
    if (!endpoint) throw new HttpsError("invalid-argument", "An endpoint is required to unsubscribe.");
    const id = subIdFromEndpoint(endpoint);
    await subsCollection.doc(id).delete();
    return { ok: true };
  }

  throw new HttpsError("invalid-argument", "Invalid status provided.");
});

export const sendTestNotification = onCall({ region: "europe-west2" }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "User must be authenticated.");
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) throw new HttpsError("failed-precondition", "VAPID keys not configured.");

  const uid = req.auth.uid;
  const snap = await db.collection(`users/${uid}/pushSubscriptions`).get();

  if (snap.empty) return { ok: true, sent: 0, removed: 0 };

  const payload = JSON.stringify({
    title: "Test Notification",
    body: "If you received this, your push notifications are working!",
    url: "/push-debug"
  });

  let sent = 0;
  let removed = 0;

  await Promise.all(
    snap.docs.map(async (doc) => {
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
          logger.error("Push send failed", err);
        }
      }
    })
  );

  return { ok: true, sent, removed };
});

// TEMP placeholder to keep file compiling if older onShiftWrite existed.
// Remove once push is stable.
export const onShiftWrite = onDocumentWritten(
  { region: "europe-west2", document: "shifts/{shiftId}" },
  async () => undefined
);

export const getNotificationStatus = onCall({ region: "europe-west2" }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "User must be authenticated.");

  const uid = req.auth.uid;

  const snap = await db
    .collection("users")
    .doc(uid)
    .collection("pushSubscriptions")
    .limit(1)
    .get();

  return { subscribed: !snap.empty };
});
