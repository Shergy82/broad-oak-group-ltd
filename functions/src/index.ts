import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import * as webpush from "web-push";

// Initialize the Firebase Admin SDK
admin.initializeApp();

// You will set these in the next step using the Firebase CLI
const vapidPublicKey = functions.config().webpush.public_key;
const vapidPrivateKey = functions.config().webpush.private_key;

// Configure the web-push library with your VAPID keys
if (vapidPublicKey && vapidPrivateKey) {
    webpush.setVapidDetails(
      "mailto:your-email@example.com", // IMPORTANT: Replace with your actual contact email
      vapidPublicKey,
      vapidPrivateKey,
    );
} else {
    functions.logger.warn("VAPID keys not configured. Push notifications will not work.");
}


/**
 * Interface for the data stored for a push subscription.
 */
interface PushSubscription {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

/**
 * This function triggers whenever a document in the 'shifts' collection is written.
 * It sends a specific push notification to the user for creation, update, or deletion events.
 */
export const sendShiftNotification = functions.firestore
  .document("shifts/{shiftId}")
  .onWrite(async (change, context) => {
    const shiftId = context.params.shiftId;
    let userId: string | undefined;
    let payload: string | null = null;
    let shiftData: admin.firestore.DocumentData | undefined;

    // Case 1: A new shift is created
    if (!change.before.exists && change.after.exists) {
        shiftData = change.after.data();
        if (shiftData) {
            userId = shiftData.userId;
            if (userId) {
                functions.logger.log(`New shift ${shiftId} created for user ${userId}.`);
                payload = JSON.stringify({
                    title: "New Shift Assigned!",
                    body: `You have a new shift for '${shiftData.task}' at ${shiftData.address}.`,
                    icon: "/icons/icon-192x192.png",
                });
            }
        }
    }
    // Case 2: A shift is updated
    else if (change.before.exists && change.after.exists) {
        shiftData = change.after.data();
        if (shiftData) {
            userId = shiftData.userId;
            if (userId) {
                functions.logger.log(`Shift ${shiftId} updated for user ${userId}.`);
                payload = JSON.stringify({
                    title: "Shift Updated!",
                    body: `Your shift for '${shiftData.task}' at ${shiftData.address} has been updated.`,
                    icon: "/icons/icon-192x192.png",
                });
            }
        }
    }
    // Case 3: A shift is deleted
    else if (change.before.exists && !change.after.exists) {
        shiftData = change.before.data();
        if (shiftData) {
            userId = shiftData.userId;
            if (userId) {
                functions.logger.log(`Shift ${shiftId} deleted for user ${userId}.`);
                payload = JSON.stringify({
                    title: "Shift Cancelled",
                    body: `Your shift for '${shiftData.task}' at ${shiftData.address} has been cancelled.`,
                    icon: "/icons/icon-192x192.png",
                });
            }
        }
    }

    if (!userId || !payload) {
      functions.logger.log(`No notification sent for shift ${shiftId}.`, { userId, payloadExists: !!payload });
      return null;
    }

    if (!vapidPublicKey || !vapidPrivateKey) {
        functions.logger.error("Cannot send push notification because VAPID keys are not set.");
        return null;
    }

    // Get all the saved push subscriptions for the affected user
    const subscriptionsSnapshot = await admin.firestore()
      .collection("users").doc(userId).collection("pushSubscriptions").get();

    if (subscriptionsSnapshot.empty) {
      functions.logger.log("No push subscriptions found for user:", userId);
      return null;
    }

    const notificationPromises = subscriptionsSnapshot.docs.map(async (subDoc) => {
      const subscription = subDoc.data() as PushSubscription;
      try {
        await webpush.sendNotification(subscription, payload as string);
      } catch (error: any) {
        // If a subscription is expired or invalid (e.g., user cleared browser data), delete it
        if (error.statusCode === 404 || error.statusCode === 410) {
          functions.logger.log(`Subscription ${subDoc.id} has expired or is no longer valid. Deleting it.`);
          await subDoc.ref.delete();
        } else {
          functions.logger.error(`Error sending notification to ${subDoc.id}, subscription not deleted.`, error);
        }
      }
    });

    await Promise.all(notificationPromises);
    return null;
  });