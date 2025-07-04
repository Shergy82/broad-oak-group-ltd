
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import * as webPush from "web-push";

admin.initializeApp();
const db = admin.firestore();

// Helper to safely get VAPID keys from the function's configuration
const getVapidKeys = () => {
  const config = functions.config();
  if (!config.webpush || !config.webpush.public_key || !config.webpush.private_key) {
    functions.logger.error("CRITICAL: VAPID keys are not configured. Run `firebase functions:config:set webpush.public_key=... webpush.private_key=...`");
    return null;
  }
  return {
    publicKey: config.webpush.public_key,
    privateKey: config.webpush.private_key,
  };
};

export const getVapidPublicKey = functions
  .region("europe-west2")
  .https.onCall((data, context) => {
    const keys = getVapidKeys();
    if (!keys) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "VAPID public key is not configured on the server."
      );
    }
    return { publicKey: keys.publicKey };
  });

export const sendShiftNotification = functions
  .region("europe-west2")
  .firestore.document("shifts/{shiftId}")
  .onWrite(async (change, context) => {
    const shiftId = context.params.shiftId;
    functions.logger.log(`Function triggered for shiftId: ${shiftId}`);

    const vapidKeys = getVapidKeys();
    if (!vapidKeys) {
      return;
    }

    webPush.setVapidDetails(
      "mailto:example@your-project.com",
      vapidKeys.publicKey,
      vapidKeys.privateKey
    );

    const shiftDataBefore = change.before.exists ? change.before.data() : null;
    const shiftDataAfter = change.after.exists ? change.after.data() : null;

    let userId: string | null = null;
    let payload: object | null = null;

    if (change.after.exists && !change.before.exists) {
      // A new shift is created
      userId = shiftDataAfter?.userId;
      payload = {
        title: "New Shift Assigned",
        body: `You have a new shift: ${shiftDataAfter?.task} at ${shiftDataAfter?.address}.`,
        data: { url: `/` },
      };
    } else if (change.after.exists && change.before.exists) {
      // A shift is updated - check if status changed
      if(shiftDataBefore?.status !== shiftDataAfter?.status) {
         userId = shiftDataAfter?.userId;
         payload = {
            title: `Shift Updated: ${shiftDataAfter?.status}`,
            body: `Your shift for ${shiftDataAfter?.task} is now ${shiftDataAfter?.status}.`,
            data: { url: `/` },
         }
      }
    } else if (!change.after.exists && change.before.exists) {
      // A shift is deleted
      userId = shiftDataBefore?.userId;
      payload = {
        title: "Shift Cancelled",
        body: `Your shift for ${shiftDataBefore?.task} at ${shiftDataBefore?.address} has been cancelled.`,
        data: { url: `/` },
      };
    } else {
      functions.logger.log(`Shift ${shiftId} was updated, no notification sent.`);
    }

    if (!userId || !payload) {
      functions.logger.log("No notification necessary for this event.", {shiftId});
      return;
    }

    functions.logger.log(`Preparing to send notification for userId: ${userId}`);

    const subscriptionsSnapshot = await db
      .collection("users")
      .doc(userId)
      .collection("pushSubscriptions")
      .get();

    if (subscriptionsSnapshot.empty) {
      functions.logger.warn(`User ${userId} has no push subscriptions. Cannot send notification.`);
      return;
    }

    functions.logger.log(`Found ${subscriptionsSnapshot.size} subscriptions for user ${userId}.`);

    const sendPromises = subscriptionsSnapshot.docs.map((subDoc) => {
      const subscription = subDoc.data();
      return webPush.sendNotification(subscription, JSON.stringify(payload)).catch((error: any) => {
        functions.logger.error(`Error sending notification to user ${userId}:`, error);
        if (error.statusCode === 410 || error.statusCode === 404) {
          functions.logger.log(`Deleting invalid subscription for user ${userId}.`);
          return subDoc.ref.delete();
        }
        return null;
      });
    });

    await Promise.all(sendPromises);
    functions.logger.log(`Finished sending notifications for shift ${shiftId}.`);
  });
