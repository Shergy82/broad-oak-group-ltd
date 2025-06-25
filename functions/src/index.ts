
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

// New Callable Function to send a test notification directly
export const sendTestNotification = functions
  .region("europe-west2")
  .https.onCall(async (data, context) => {
    // 1. Authentication check
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "The function must be called while authenticated."
      );
    }
    
    // 2. Authorization check: Is the caller an admin or owner?
    const callerUid = context.auth.uid;
    const callerDoc = await db.collection("users").doc(callerUid).get();
    const callerProfile = callerDoc.data();
    
    if (!callerProfile || !['admin', 'owner'].includes(callerProfile.role)) {
        throw new functions.https.HttpsError(
            'permission-denied',
            'You do not have permission to perform this action.'
        );
    }

    // 3. Get target user ID from the data passed in
    const targetUserId = data.userId;
    if (!targetUserId || typeof targetUserId !== 'string') {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'The function must be called with a "userId" string argument.'
        );
    }

    // 4. Get VAPID keys
    const vapidKeys = getVapidKeys();
    if (!vapidKeys) {
        functions.logger.error("VAPID keys are not configured. Cannot send test notification.");
        return { success: false, error: "VAPID keys not set on server." };
    }

    webPush.setVapidDetails(
      "mailto:example@your-project.com",
      vapidKeys.publicKey,
      vapidKeys.privateKey
    );

    // 5. Get subscriptions for the target user
    const subscriptionsSnapshot = await db
      .collection("users")
      .doc(targetUserId)
      .collection("pushSubscriptions")
      .get();

    if (subscriptionsSnapshot.empty) {
      functions.logger.log(`User ${targetUserId} has no subscriptions.`);
      return { success: true, message: "User has no push notification subscriptions." };
    }

    // 6. Send the notifications
    const payload = JSON.stringify({
        title: "Test Notification",
        body: "This is a test notification from the admin panel.",
        data: { url: `/` },
    });

    const sendPromises = subscriptionsSnapshot.docs.map((subDoc) => {
      const subscription = subDoc.data();
      return webPush.sendNotification(subscription, payload).catch((error) => {
        functions.logger.error(`Error sending notification to user ${targetUserId}:`, error);
        if (error.statusCode === 410 || error.statusCode === 404) {
          functions.logger.log(`Deleting invalid subscription for user ${targetUserId}.`);
          return subDoc.ref.delete();
        }
        return null;
      });
    });

    await Promise.all(sendPromises);

    functions.logger.log(`Successfully attempted to send test notification to user ${targetUserId}.`);
    return { success: true };
});
