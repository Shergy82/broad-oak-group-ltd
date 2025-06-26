import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import * as webPush from "web-push";

admin.initializeApp();

const db = admin.firestore();

// Helper to safely get VAPID keys from the function's configuration
const getVapidKeys = () => {
  const config = functions.config();
  // Check for the existence of the webpush object and its keys
  if (!config.webpush || !config.webpush.public_key || !config.webpush.private_key) {
    return null;
  }
  return {
    publicKey: config.webpush.public_key,
    privateKey: config.webpush.private_key,
  };
};

export const sendShiftNotification = functions
  .region("europe-west2") // Specify the London region
  .firestore.document("shifts/{shiftId}")
  .onWrite(async (change, context) => {
    const shiftId = context.params.shiftId;
    functions.logger.log(`Function triggered for shiftId: ${shiftId}`);

    const vapidKeys = getVapidKeys();
    if (!vapidKeys) {
      functions.logger.error("CRITICAL: VAPID keys are not configured in Firebase Functions environment. Push notifications cannot be sent. Run the Firebase CLI command from the 'VAPID Key Generator' in the admin panel.");
      return null;
    }

    // Configure web-push with your VAPID keys
    webPush.setVapidDetails(
      "mailto:example@your-project.com", // This can be a placeholder email
      vapidKeys.publicKey,
      vapidKeys.privateKey
    );

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
    else {
        functions.logger.log(`Shift ${shiftId} was updated, no notification sent.`);
    }

    if (!userId || !payload) {
      functions.logger.log("No notification necessary for this event (e.g., an update).", {shiftId});
      return null;
    }

    functions.logger.log(`Preparing to send notification for userId: ${userId}`);

    // Get all push subscriptions for the user
    const subscriptionsSnapshot = await db
      .collection("users")
      .doc(userId)
      .collection("pushSubscriptions")
      .get();

    if (subscriptionsSnapshot.empty) {
      functions.logger.warn(`User ${userId} has no push subscriptions. Cannot send notification. Did the user subscribe in the browser?`);
      return null;
    }

    functions.logger.log(`Found ${subscriptionsSnapshot.size} subscriptions for user ${userId}. Preparing to send.`);

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
