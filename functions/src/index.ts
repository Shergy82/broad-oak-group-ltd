
import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";
import * as webPush from "web-push";

admin.initializeApp();

const db = admin.firestore();

// Helper to safely get VAPID keys from the function's configuration
const getVapidKeys = () => {
  const config = functions.config();
  // Check for the existence of the webpush object and its keys
  if (!config.webpush || !config.webpush.public_key || !config.webpush.private_key) {
    functions.logger.warn("VAPID keys are not configured. Skipping push notification.");
    return null;
  }
  return {
    publicKey: config.webpush.public_key,
    privateKey: config.webpush.private_key,
  };
};

// NEW: Callable function to expose the public key to the client
export const getVapidPublicKey = functions
  .region("europe-west2")
  .https.onCall((data, context) => {
    // No auth check needed, this key is public by nature.
    const vapidKeys = getVapidKeys();
    if (!vapidKeys) {
      functions.logger.error("Could not retrieve VAPID public key because keys are not configured.");
      throw new functions.https.HttpsError(
        "failed-precondition",
        "The VAPID keys are not configured on the server."
      );
    }
    return { publicKey: vapidKeys.publicKey };
  });

export const sendShiftNotification = functions
  .region("europe-west2") // Specify the London region
  .firestore.document("shifts/{shiftId}")
  .onWrite(async (change, context) => {
    const vapidKeys = getVapidKeys();
    if (!vapidKeys) {
      return null; // Exit gracefully if keys are not set
    }

    // Configure web-push with your VAPID keys
    webPush.setVapidDetails(
      "mailto:example@your-project.com", // This can be a placeholder email
      vapidKeys.publicKey,
      vapidKeys.privateKey
    );

    const shiftId = context.params.shiftId;
    const shiftDataAfter = change.after.exists ? change.after.data() as admin.firestore.DocumentData : null;
    const shiftDataBefore = change.before.exists ? change.before.data() as admin.firestore.DocumentData : null;

    let userId: string | null = null;
    let payload: object | null = null;

    // Case 1: A new shift is created
    if (!shiftDataBefore && shiftDataAfter) {
      userId = shiftDataAfter.userId;
      payload = {
        title: "New Shift Assigned",
        body: `You have a new shift: ${shiftDataAfter.task} at ${shiftDataAfter.address}.`,
        data: { url: `/` }, // URL to open when notification is clicked
      };
    }
    // Case 2: A shift is deleted
    else if (shiftDataBefore && !shiftDataAfter) {
      userId = shiftDataBefore.userId;
      payload = {
        title: "Shift Cancelled",
        body: `Your shift for ${shiftDataBefore.task} at ${shiftDataBefore.address} has been cancelled.`,
        data: { url: `/` },
      };
    }
    // Case 3: A shift is updated (optional, can be noisy)
    // To keep it simple, we'll log but not send a notification for updates.
    else {
        functions.logger.log(`Shift ${shiftId} was updated, no notification sent.`);
    }

    if (!userId || !payload) {
      functions.logger.log("No notification necessary for this event.");
      return null;
    }

    // Get all push subscriptions for the user
    const subscriptionsSnapshot = await db
      .collection("users")
      .doc(userId)
      .collection("pushSubscriptions")
      .get();

    if (subscriptionsSnapshot.empty) {
      functions.logger.log(`User ${userId} has no subscriptions.`);
      return null;
    }

    const sendPromises = subscriptionsSnapshot.docs.map((subDoc) => {
      const subscription = subDoc.data();
      // The payload must be a string or buffer
      return webPush.sendNotification(subscription, JSON.stringify(payload)).catch((error) => {
        functions.logger.error(`Error sending notification to user ${userId}:`, error);
        // If a subscription is no longer valid, delete it from Firestore
        if (error.statusCode === 410 || error.statusCode === 404) {
          functions.logger.log(`Deleting invalid subscription for user ${userId}.`);
          return subDoc.ref.delete();
        }
        return null;
      });
    });

    await Promise.all(sendPromises);
    functions.logger.log(`Finished sending notifications for shift ${shiftId}.`);
    return null;
  });
