
import * as functions from "firebase-functions/v2";
import * as logger from "firebase-functions/logger";
import admin from "firebase-admin";
import * as webPush from "web-push";

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

// --- Helper to configure web-push ---
const configureWebPush = () => {
  const publicKey = functions.config().webpush?.public_key;
  const privateKey = functions.config().webpush?.private_key;

  if (!publicKey || !privateKey) {
    logger.error("CRITICAL: VAPID keys are not configured in function environment.");
    return false;
  }
  try {
    webPush.setVapidDetails("mailto:example@your-project.com", publicKey, privateKey);
    return true;
  } catch (error) {
    logger.error("Error setting VAPID details:", error);
    return false;
  }
};


// --- Callable Functions (v2) ---

export const getVapidPublicKey = functions.https.onCall(
  { region: "europe-west2" },
  (req) => {
    const publicKey = functions.config().webpush?.public_key;
    if (!publicKey) {
      logger.error("VAPID public key not set in function config.");
      throw new functions.https.HttpsError('not-found', 'VAPID public key is not configured on the server.');
    }
    return { publicKey };
  }
);


export const setNotificationStatus = functions.https.onCall(
  { region: "europe-west2" },
  async (req) => {
    if (!req.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'You must be logged in.');
    }
    const uid = req.auth.uid;
    const { status, subscription, endpoint } = req.data;
    const subsCollection = db.collection('users').doc(uid).collection('pushSubscriptions');

    if (status === 'subscribed') {
      if (!subscription || !subscription.endpoint) {
        throw new functions.https.HttpsError('invalid-argument', 'A valid subscription object is required.');
      }
      const subId = btoa(subscription.endpoint).replace(/=/g, '');
      await subsCollection.doc(subId).set({ ...subscription, createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      return { ok: true, message: "Subscribed successfully." };
    } else if (status === 'unsubscribed') {
      if (!endpoint) {
        throw new functions.https.HttpsError('invalid-argument', 'A subscription endpoint is required to unsubscribe.');
      }
      const subId = btoa(endpoint).replace(/=/g, '');
      await subsCollection.doc(subId).delete();
      return { ok: true, message: "Unsubscribed successfully." };
    } else {
      throw new functions.https.HttpsError('invalid-argument', 'Invalid status provided.');
    }
  }
);

export const sendTestNotification = functions.https.onCall(
    { region: "europe-west2" },
    async (req) => {
      if (!req.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'You must be logged in.');
      }
      if (!configureWebPush()) {
        throw new functions.https.HttpsError('failed-precondition', 'VAPID keys not configured on server.');
      }
      const uid = req.auth.uid;
      const subscriptionsSnapshot = await db.collection(`users/${uid}/pushSubscriptions`).get();

      if (subscriptionsSnapshot.empty) {
        return { ok: true, sent: 0, removed: 0, message: "No subscriptions found for user." };
      }

      const payload = JSON.stringify({
        title: "Test Notification",
        body: "This is a test notification from your app.",
        data: { url: "/push-debug" }
      });

      let sentCount = 0;
      let removedCount = 0;

      const sendPromises = subscriptionsSnapshot.docs.map(async (subDoc) => {
        const sub = subDoc.data() as webPush.PushSubscription;
        try {
          await webPush.sendNotification(sub, payload);
          sentCount++;
        } catch (error: any) {
          if (error.statusCode === 404 || error.statusCode === 410) {
            await subDoc.ref.delete();
            removedCount++;
          } else {
            logger.error(`Test notification failed for user ${uid}`, error);
          }
        }
      });

      await Promise.all(sendPromises);
      return { ok: true, sent: sentCount, removed: removedCount, message: `Sent ${sentCount} notifications.` };
    }
);


// --- Firestore Trigger (v2) ---
export const onShiftWrite = functions.firestore.onDocumentWritten(
  { document: "shifts/{shiftId}", region: "europe-west2" },
  async (event) => {
    if (!configureWebPush()) return;

    const shiftId = event.params.shiftId;
    const shiftBefore = event.data?.before.data();
    const shiftAfter = event.data?.after.data();

    let userId: string | null = null;
    let payload: object | null = null;
    
    if (!event.data?.before.exists && event.data?.after.exists) { // Create
      userId = shiftAfter?.userId;
      payload = { title: "New Shift Assigned", body: `You have a new shift: ${shiftAfter?.task}`, data: { url: `/dashboard?gate=pending` } };
      logger.log(`Shift CREATED for ${userId}`, { shiftId });
    } else if (event.data?.before.exists && !event.data?.after.exists) { // Delete
      userId = shiftBefore?.userId;
      payload = { title: "Shift Cancelled", body: `Your shift for ${shiftBefore?.task} has been cancelled.`, data: { url: `/dashboard` } };
      logger.log(`Shift DELETED for ${userId}`, { shiftId });
    } else if (event.data?.before.exists && event.data?.after.exists) { // Update
        if (shiftBefore?.userId !== shiftAfter?.userId) {
            // Re-assigned, notify both old and new user
            const oldUserId = shiftBefore?.userId;
            const newUserId = shiftAfter?.userId;
            if (oldUserId) {
                const oldUserPayload = { title: "Shift Unassigned", body: `A shift for ${shiftBefore?.task} has been reassigned.`, data: { url: `/dashboard` } };
                await sendNotificationToUser(oldUserId, oldUserPayload);
            }
            if (newUserId) {
                 const newUserPayload = { title: "New Shift Assigned", body: `You have been assigned a shift for ${shiftAfter?.task}.`, data: { url: `/dashboard?gate=pending` } };
                 await sendNotificationToUser(newUserId, newUserPayload);
            }
            return; // Exit after handling reassignment
        }

        // Updated for the same user, check for meaningful changes
        userId = shiftAfter?.userId;
        const hasChanged = shiftBefore?.task !== shiftAfter?.task || shiftBefore?.date.seconds !== shiftAfter?.date.seconds || shiftBefore?.address !== shiftAfter?.address || shiftBefore?.type !== shiftAfter?.type;
        if (hasChanged) {
            payload = { title: "Shift Updated", body: `Your shift for ${shiftAfter?.task} has changed.`, data: { url: `/dashboard` } };
            logger.log(`Shift UPDATED for ${userId}`, { shiftId });
        }
    }
    
    if (userId && payload) {
      await sendNotificationToUser(userId, payload);
    } else {
      logger.log("No notification needed for this event.", { shiftId });
    }
  }
);


async function sendNotificationToUser(userId: string, payload: object) {
    const subscriptionsSnapshot = await db.collection(`users/${userId}/pushSubscriptions`).get();
    if (subscriptionsSnapshot.empty) {
      logger.warn(`No subscriptions for user ${userId}.`);
      return;
    }

    const sendPromises = subscriptionsSnapshot.docs.map(subDoc => {
        const sub = subDoc.data() as webPush.PushSubscription;
        return webPush.sendNotification(sub, JSON.stringify(payload)).catch(error => {
            if (error.statusCode === 404 || error.statusCode === 410) {
                return subDoc.ref.delete();
            }
            logger.error(`Failed to send to ${sub.endpoint.slice(0,30)}...`, { error });
            return null;
        });
    });

    await Promise.all(sendPromises);
}
