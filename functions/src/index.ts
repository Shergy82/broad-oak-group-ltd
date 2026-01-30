// This is a comprehensive rewrite of the push notification backend logic.
'use server';
import * as functions from "firebase-functions";
import admin from "firebase-admin";
import * as webPush from "web-push";

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

// --- VAPID Key Configuration ---
// This function initializes the web-push library with the VAPID keys
// stored in Firebase Functions configuration.
const configureWebPush = () => {
  const config = functions.config();
  const publicKey = config.webpush?.public_key;
  const privateKey = config.webpush?.private_key;
  const mailto = config.webpush?.subject || 'mailto:example@your-project.com';

  if (!publicKey || !privateKey) {
    functions.logger.error("CRITICAL: VAPID keys (webpush.public_key, webpush.private_key) are not set in function configuration. Notifications will fail.");
    return false;
  }

  try {
    webPush.setVapidDetails(mailto, publicKey, privateKey);
    return true;
  } catch (error) {
    functions.logger.error("Error setting VAPID details:", error);
    return false;
  }
};

// --- Callable Function: getVapidPublicKey ---
// Securely provides the VAPID public key to the client app.
export const getVapidPublicKey = functions.region("europe-west2").https.onCall((data, context) => {
  const publicKey = functions.config().webpush?.public_key;
  if (!publicKey) {
    functions.logger.error("CRITICAL: VAPID public key not set in config.");
    throw new functions.https.HttpsError('not-found', 'VAPID public key is not configured on the server.');
  }
  return { publicKey };
});

// --- Callable Function: setNotificationStatus ---
// Manages a user's push notification subscriptions.
export const setNotificationStatus = functions.region("europe-west2").https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "You must be logged in to manage notifications.");
  }
  const uid = context.auth.uid;
  const { status, subscription } = data;

  const userSubscriptionsRef = db.collection('users').doc(uid).collection('pushSubscriptions');
  
  if (status === 'subscribed') {
    if (!subscription || !subscription.endpoint) {
      throw new functions.https.HttpsError('invalid-argument', 'A valid subscription object is required.');
    }
    // Use a hash of the endpoint as the document ID to prevent duplicates.
    const subId = btoa(subscription.endpoint).replace(/=/g, '');
    await userSubscriptionsRef.doc(subId).set({
      ...subscription,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    functions.logger.log(`Subscription added for user: ${uid}`);
    return { ok: true, message: "Subscribed successfully." };

  } else if (status === 'unsubscribed') {
    if (!subscription || !subscription.endpoint) {
      throw new functions.https.HttpsError('invalid-argument', 'A subscription endpoint is required to unsubscribe.');
    }
    const subId = btoa(subscription.endpoint).replace(/=/g, '');
    await userSubscriptionsRef.doc(subId).delete();
    functions.logger.log(`Subscription removed for user: ${uid}`);
    return { ok: true, message: "Unsubscribed successfully." };

  } else {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid status provided.');
  }
});


// --- Firestore Trigger: onShiftWrite ---
// Triggers when a shift is created, updated, or deleted.
export const onShiftWrite = functions.region("europe-west2").firestore.document("shifts/{shiftId}")
  .onWrite(async (change, context) => {
    
    // Check if VAPID keys are configured before proceeding.
    if (!configureWebPush()) {
      return;
    }
    
    const shiftId = context.params.shiftId;
    const shiftBefore = change.before.data();
    const shiftAfter = change.after.data();

    let userId: string | null = null;
    let payload: object | null = null;
    
    // --- Determine Notification Type ---
    if (!change.before.exists && change.after.exists) {
      // 1. Shift CREATED
      userId = shiftAfter?.userId;
      payload = {
        title: "New Shift Assigned",
        body: `You have a new shift: ${shiftAfter?.task}`,
        url: `/dashboard?gate=pending`,
      };
      functions.logger.log(`Shift CREATED for user ${userId}`, { shiftId });

    } else if (change.before.exists && !change.after.exists) {
      // 2. Shift DELETED
      userId = shiftBefore?.userId;
      payload = {
        title: "Shift Cancelled",
        body: `A shift for ${shiftBefore?.task} has been cancelled.`,
        url: "/dashboard",
      };
      functions.logger.log(`Shift DELETED for user ${userId}`, { shiftId });

    } else if (change.before.exists && change.after.exists) {
      // 3. Shift UPDATED
      if (shiftBefore?.userId !== shiftAfter?.userId) {
          // Re-assignment: Handled by treating as a delete for the old user and create for the new.
          // The onWrite will trigger again for the new user.
          // For now, we just notify the old user.
          userId = shiftBefore?.userId;
          payload = { title: "Shift Re-assigned", body: `Your shift for ${shiftBefore?.task} is no longer assigned to you.`, url: "/dashboard" };
      } else {
          // A meaningful field changed for the same user
          const hasMeaningfulChange = shiftBefore?.task !== shiftAfter?.task || shiftBefore?.address !== shiftAfter?.address || shiftBefore?.date.seconds !== shiftAfter?.date.seconds;
          if (hasMeaningfulChange) {
            userId = shiftAfter?.userId;
            payload = {
              title: "Shift Details Updated",
              body: `Your shift for ${shiftAfter?.task} has been updated.`,
              url: `/dashboard`
            };
            functions.logger.log(`Shift UPDATED for user ${userId}`, { shiftId });
          }
      }
    }
    
    if (!userId || !payload) {
      functions.logger.log("No notification needed for this event.", { shiftId });
      return;
    }

    // --- Send Notification ---
    const subscriptionsSnapshot = await db.collection(`users/${userId}/pushSubscriptions`).get();

    if (subscriptionsSnapshot.empty) {
      functions.logger.warn(`No push subscriptions found for user ${userId}.`);
      return;
    }

    const sendPromises = subscriptionsSnapshot.docs.map(subDoc => {
        const sub = subDoc.data() as webPush.PushSubscription;
        return webPush.sendNotification(sub, JSON.stringify(payload))
            .catch(error => {
                functions.logger.error(`Failed to send notification to ${sub.endpoint.slice(0, 30)}...`, { userId, error });
                // If the subscription is expired or invalid, delete it from Firestore.
                if (error.statusCode === 404 || error.statusCode === 410) {
                    functions.logger.log(`Deleting stale subscription for user ${userId}.`);
                    return subDoc.ref.delete();
                }
                return null; // Don't re-throw, just log the error.
            });
    });

    await Promise.all(sendPromises);
    functions.logger.log(`Successfully processed notifications for user ${userId}.`);
  });

// --- Callable Function: sendTestNotification ---
export const sendTestNotification = functions.region("europe-west2").https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Authentication required.");
  }
  if (!configureWebPush()) {
    throw new functions.https.HttpsError("failed-precondition", "VAPID keys not configured on server.");
  }

  const userId = context.auth.uid;
  const subscriptionsSnapshot = await db.collection(`users/${userId}/pushSubscriptions`).get();

  if (subscriptionsSnapshot.empty) {
    return { ok: true, sent: 0, removed: 0, message: "No subscriptions found for this user." };
  }

  const payload = JSON.stringify({
    title: "Test Notification",
    body: "This is a test notification from the app.",
    url: "/push-debug"
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
        functions.logger.error(`Test notification failed for user ${userId}`, error);
      }
    }
  });

  await Promise.all(sendPromises);

  return { ok: true, sent: sentCount, removed: removedCount, message: `Sent ${sentCount} test notifications.` };
});
