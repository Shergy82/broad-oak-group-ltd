
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import * as webPush from "web-push";
import { defineString } from "firebase-functions/params";

// Define parameters for VAPID keys using the new recommended way.
// The values MUST be lowercase.
const VAPID_PUBLIC_KEY = defineString("webpush_public_key");
const VAPID_PRIVATE_KEY = defineString("webpush_private_key");

admin.initializeApp();
const db = admin.firestore();

/**
 * Provides the VAPID public key to the client application.
 * This is a public key and is safe to expose.
 */
export const getVapidPublicKey = onCall({ region: "europe-west2" }, (request) => {
  const publicKey = VAPID_PUBLIC_KEY.value();
  if (!publicKey) {
    logger.error("CRITICAL: VAPID public key (webpush_public_key) not set in function configuration.");
    throw new HttpsError('not-found', 'VAPID public key is not configured on the server.');
  }
  
  return { publicKey };
});

export const sendShiftNotification = onDocumentWritten(
  {
    document: "shifts/{shiftId}",
    region: "europe-west2",
  },
  async (event) => {
    const shiftId = event.params.shiftId;
    logger.log(`Function triggered for shiftId: ${shiftId}`);

    const publicKey = VAPID_PUBLIC_KEY.value();
    const privateKey = VAPID_PRIVATE_KEY.value();

    if (!publicKey || !privateKey) {
      logger.error("CRITICAL: VAPID keys are not configured. Run the Firebase CLI command from the 'VAPID Key Generator' in the admin panel to set webpush_public_key and webpush_private_key.");
      return;
    }

    webPush.setVapidDetails(
      "mailto:example@your-project.com",
      publicKey,
      privateKey
    );

    const shiftDataBefore = event.data?.before.data();
    const shiftDataAfter = event.data?.after.data();
    
    let userId: string | null = null;
    let payload: object | null = null;

    if (event.data?.after.exists && !event.data?.before.exists) {
      // A new shift is created
      userId = shiftDataAfter?.userId;
      payload = {
        title: "New Shift Assigned",
        body: `You have a new shift: ${shiftDataAfter?.task} at ${shiftDataAfter?.address}.`,
        data: { url: `/` },
      };
    } else if (!event.data?.after.exists && event.data?.before.exists) {
      // A shift is deleted
      userId = shiftDataBefore?.userId;
      payload = {
        title: "Shift Cancelled",
        body: `Your shift for ${shiftDataBefore?.task} at ${shiftDataBefore?.address} has been cancelled.`,
        data: { url: `/` },
      };
    } else {
      logger.log(`Shift ${shiftId} was updated, no notification sent.`);
    }

    if (!userId || !payload) {
      logger.log("No notification necessary for this event.", {shiftId});
      return;
    }

    logger.log(`Preparing to send notification for userId: ${userId}`);

    const subscriptionsSnapshot = await db
      .collection("users")
      .doc(userId)
      .collection("pushSubscriptions")
      .get();

    if (subscriptionsSnapshot.empty) {
      logger.warn(`User ${userId} has no push subscriptions. Cannot send notification.`);
      return;
    }

    logger.log(`Found ${subscriptionsSnapshot.size} subscriptions for user ${userId}.`);

    const sendPromises = subscriptionsSnapshot.docs.map((subDoc) => {
      const subscription = subDoc.data();
      return webPush.sendNotification(subscription, JSON.stringify(payload)).catch((error: any) => {
        logger.error(`Error sending notification to user ${userId}:`, error);
        if (error.statusCode === 410 || error.statusCode === 404) {
          logger.log(`Deleting invalid subscription for user ${userId}.`);
          return subDoc.ref.delete();
        }
        return null;
      });
    });

    await Promise.all(sendPromises);
    logger.log(`Finished sending notifications for shift ${shiftId}.`);
  }
);
