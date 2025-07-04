
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import * as webPush from "web-push";
import { defineString } from "firebase-functions/params";

// Define parameters for VAPID keys using the new recommended way.
// The values MUST be lowercase and snake_cased.
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

/**
 * This function triggers when a shift document is written (created, updated, or deleted) in Firestore.
 * It sends a push notification to the assigned user.
 */
export const sendShiftNotification = onDocumentWritten(
  {
    document: "shifts/{shiftId}",
    region: "europe-west2",
  },
  async (event) => {
    const shiftId = event.params.shiftId;
    
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

    // Case 1: A new shift is created
    if (event.data?.after.exists && !event.data?.before.exists) {
      userId = shiftDataAfter?.userId;
      payload = {
        title: "New Shift Assigned",
        body: `You have a new shift: ${shiftDataAfter?.task} at ${shiftDataAfter?.address}.`,
        data: { url: `/` },
      };
      logger.log(`New shift created for user ${userId}.`, { shiftId });
    } 
    // Case 2: A shift is deleted
    else if (!event.data?.after.exists && event.data?.before.exists) {
      userId = shiftDataBefore?.userId;
      payload = {
        title: "Shift Cancelled",
        body: `Your shift for ${shiftDataBefore?.task} at ${shiftDataBefore?.address} has been cancelled.`,
        data: { url: `/` },
      };
      logger.log(`Shift deleted for user ${userId}.`, { shiftId });
    }
    // Case 3: A shift is updated
    else if (shiftDataBefore && shiftDataAfter) {
        const hasChanged = shiftDataBefore.task !== shiftDataAfter.task || 
                         shiftDataBefore.address !== shiftDataAfter.address ||
                         shiftDataBefore.type !== shiftDataAfter.type ||
                         !shiftDataBefore.date.isEqual(shiftDataAfter.date);
        
        if (hasChanged) {
            userId = shiftDataAfter.userId;
            payload = {
                title: "Shift Updated",
                body: `Your shift for ${shiftDataAfter.task} at ${shiftDataAfter.address} has been updated.`,
                data: { url: `/` }
            };
            logger.log(`Shift updated for user ${userId}.`, { shiftId });
        } else {
            logger.log(`Shift was written but no meaningful change detected for notification. Status change: ${shiftDataBefore.status} -> ${shiftDataAfter.status}`, { shiftId });
        }
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
        // If a subscription is no longer valid, delete it.
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
