
import { onCall, HttpsError } from "firebase-functions/v2/https";

import cors from "cors";
import * as admin from "firebase-admin";
import * as webPush from "web-push";
import { onDocumentWritten } from "firebase-functions/v2/firestore";

admin.initializeApp();
const db = admin.firestore();
const europeWest2 = "europe-west2";
const corsHandler = cors({ origin: true });

// Define a converter for the PushSubscription type for type safety.
const pushSubscriptionConverter = {
    toFirestore(subscription: webPush.PushSubscription): admin.firestore.DocumentData {
        return { endpoint: subscription.endpoint, keys: subscription.keys };
    },
    fromFirestore(snapshot: admin.firestore.QueryDocumentSnapshot): webPush.PushSubscription {
        const data = snapshot.data();
        if (!data.endpoint || !data.keys || !data.keys.p256dh || !data.keys.auth) {
            throw new Error("Invalid PushSubscription data from Firestore.");
        }
        return {
            endpoint: data.endpoint,
            keys: {
                p256dh: data.keys.p256dh,
                auth: data.keys.auth
            }
        };
    }
};

// Callable function for the client to update their notification subscription status.
export const setNotificationStatus = onRequest({ region: europeWest2 }, (req, res) => {
  return corsHandler(req, res, async () => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    try {
      const auth = req.get("Authorization") || "";
      const m = auth.match(/^Bearer\s+(.+)$/i);
      if (!m) {
        res.status(401).json({ error: "Missing Authorization: Bearer <token>" });
        return;
      }

      const decoded = await admin.auth().verifyIdToken(m[1]);
      const uid = decoded.uid;

      const enabled = !!req.body?.enabled;
      const subscription = req.body?.subscription;

      const userSubscriptionsRef = db.collection("users").doc(uid).collection("pushSubscriptions");

      if (enabled) {
        if (!subscription || !subscription.endpoint) {
          res.status(400).json({ error: "A valid subscription object is required to subscribe." });
          return;
        }
        const docId = Buffer.from(subscription.endpoint).toString("base64");
        await userSubscriptionsRef.doc(docId).set({ endpoint: subscription.endpoint, keys: subscription.keys });
      } else {
        const snap = await userSubscriptionsRef.get();
        if (!snap.empty) {
          const batch = db.batch();
          snap.docs.forEach((d) => batch.delete(d.ref));
          await batch.commit();
        }
      }

      res.json({ success: true });
    } catch (e) {
      res.status(400).json({ error: e?.message || "Unknown error" });
    }
  });
});

// Firestore trigger that sends notifications on shift changes.
export const onShiftWrite = onDocumentWritten({ document: "shifts/{shiftId}", region: "europe-west2" }, async (event) => {
    const shiftId = event.params.shiftId;
    
    // Global notification kill switch
    const settingsDoc = await db.collection('settings').doc('notifications').get();
    if (settingsDoc.exists && settingsDoc.data()?.enabled === false) {
      console.log('Global notifications are disabled. Aborting.');
      return;
    }

    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;

    if (!publicKey || !privateKey) {
        console.error("CRITICAL: VAPID keys are not configured in environment.");
        return;
    }

    webPush.setVapidDetails("mailto:example@your-project.com", publicKey, privateKey);

    const beforeData = event.data?.before.data();
    const afterData = event.data?.after.data();

    let userId: string | null = null;
    let payload: object | null = null;

    if (event.data?.after.exists && !event.data?.before.exists) { // CREATE
        userId = afterData?.userId;
        payload = {
            title: "New Shift Assigned",
            body: `You have a new shift: ${afterData?.task} at ${afterData?.address}.`,
            data: { url: `/dashboard` },
        };
    } else if (!event.data?.after.exists && event.data?.before.exists) { // DELETE
        userId = beforeData?.userId;
        payload = {
            title: "Shift Cancelled",
            body: `Your shift for ${beforeData?.task} at ${beforeData?.address} has been cancelled.`,
            data: { url: `/dashboard` },
        };
    } else if (event.data?.after.exists && event.data?.before.exists) { // UPDATE
        // Determine if there's a meaningful change that warrants a notification
        if (beforeData?.userId !== afterData?.userId) {
            // Re-assignment logic can be added here if needed
        } else if (beforeData?.task !== afterData?.task || beforeData?.address !== afterData?.address || !beforeData?.date.isEqual(afterData?.date)) {
            userId = afterData?.userId;
            payload = {
                title: "Your Shift Has Been Updated",
                body: `The details for one of your shifts have changed.`,
                data: { url: `/dashboard` },
            };
        }
    }

    if (!userId || !payload) {
        console.log("No notification necessary for this event.");
        return;
    }

    const subscriptionsSnapshot = await db
      .collection("users")
      .doc(userId)
      .collection("pushSubscriptions")
      .withConverter(pushSubscriptionConverter)
      .get();

    if (subscriptionsSnapshot.empty) {
      console.warn(`User ${userId} has no push subscriptions.`);
      return;
    }

    const sendPromises = subscriptionsSnapshot.docs.map((subDoc) => {
        const subscription = subDoc.data();
        return webPush.sendNotification(subscription, JSON.stringify(payload)).catch((error: any) => {
            console.error(`Error sending notification to user ${userId}:`, error);
            if (error.statusCode === 410 || error.statusCode === 404) {
                return subDoc.ref.delete(); // Prune expired/invalid subscription
            }
            return null;
        });
    });

    await Promise.all(sendPromises);
});