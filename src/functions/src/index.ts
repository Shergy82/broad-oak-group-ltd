
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import * as webPush from "web-push";

admin.initializeApp();
const db = admin.firestore();

// Define a converter for the PushSubscription type.
// This is the modern, correct way to handle typed data with Firestore.
// It ensures that when we fetch data, it's already in the correct shape.
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


// This is the v1 SDK syntax for onCall functions
export const getVapidPublicKey = functions.region("europe-west2").https.onCall((data, context) => {
    const publicKey = functions.config().webpush?.public_key;
    if (!publicKey) {
        functions.logger.error("CRITICAL: VAPID public key (webpush.public_key) not set in function configuration.");
        throw new functions.https.HttpsError('not-found', 'VAPID public key is not configured on the server.');
    }
    return { publicKey };
});

export const sendShiftNotification = functions.region("europe-west2").firestore.document("shifts/{shiftId}")
  .onWrite(async (change, context) => {
    const shiftId = context.params.shiftId;
    functions.logger.log(`Function triggered for shiftId: ${shiftId}`);

    const config = functions.config();
    const publicKey = config.webpush?.public_key;
    const privateKey = config.webpush?.private_key;

    if (!publicKey || !privateKey) {
      functions.logger.error("CRITICAL: VAPID keys are not configured. Run the Firebase CLI command from the 'VAPID Key Generator' in the admin panel.");
      return;
    }

    webPush.setVapidDetails(
      "mailto:example@your-project.com",
      publicKey,
      privateKey
    );

    const shiftDataBefore = change.before.data();
    const shiftDataAfter = change.after.data();
    
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
    } else if (!change.after.exists && change.before.exists) {
      // A shift is deleted
      userId = shiftDataBefore?.userId;
      payload = {
        title: "Shift Cancelled",
        body: `Your shift for ${shiftDataBefore?.task} at ${shiftDataBefore?.address} has been cancelled.`,
        data: { url: `/` },
      };
    } else if (change.after.exists && change.before.exists) {
      // A shift is updated. Check for meaningful changes.
      const before = change.before.data();
      const after = change.after.data();

      // Compare relevant fields.
      const taskChanged = before.task !== after.task;
      const addressChanged = before.address !== after.address;
      const dateChanged = !before.date.isEqual(after.date);
      const typeChanged = before.type !== after.type;

      if (taskChanged || addressChanged || dateChanged || typeChanged) {
        userId = after.userId;
        payload = {
          title: "Your Shift Has Been Updated",
          body: `Details for one of your shifts have changed. Please check the app.`,
          data: { url: `/` },
        };
      } else {
        // No meaningful change, so no notification.
        functions.logger.log(`Shift ${shiftId} was updated, but no significant fields changed. No notification sent.`);
        return;
      }
    } else {
      functions.logger.log(`Shift ${shiftId} was updated, no notification sent.`);
      return;
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
      .withConverter(pushSubscriptionConverter) // Apply the converter here
      .get();

    if (subscriptionsSnapshot.empty) {
      functions.logger.warn(`User ${userId} has no push subscriptions. Cannot send notification.`);
      return;
    }

    functions.logger.log(`Found ${subscriptionsSnapshot.size} subscriptions for user ${userId}.`);

    const sendPromises = subscriptionsSnapshot.docs.map((subDoc) => {
      // Thanks to the converter, subDoc.data() is now correctly typed as PushSubscription.
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
