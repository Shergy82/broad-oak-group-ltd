
'use server';
import * as functions from "firebase-functions";
import admin from "firebase-admin";
import * as webPush from "web-push";

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

// Set VAPID details from Function configuration
try {
  const vapidKeys = functions.config().webpush;
  if (vapidKeys && vapidKeys.public_key && vapidKeys.private_key) {
    webPush.setVapidDetails(
      'mailto:example@your-project.com',
      vapidKeys.public_key,
      vapidKeys.private_key
    );
  } else {
    functions.logger.error("VAPID keys not found in function configuration. Push notifications will fail.");
  }
} catch (e) {
    functions.logger.error("Could not set VAPID details, webpush config likely missing.", e);
}


/**
 * Returns the VAPID public key to the client.
 */
export const getVapidPublicKey = functions.region("europe-west2").https.onCall((data, context) => {
    const publicKey = functions.config().webpush?.public_key;
    if (!publicKey) {
        functions.logger.error("VAPID public key is not configured.");
        throw new functions.https.HttpsError('not-found', 'VAPID public key is not configured on the server.');
    }
    return { publicKey };
});

/**
 * Manages user push notification subscriptions.
 */
export const setNotificationStatus = functions.region("europe-west2").https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
    }

    const { subscription, state } = data; // state is 'subscribe' or 'unsubscribe'
    const uid = context.auth.uid;
    const subsCollection = db.collection('users').doc(uid).collection('pushSubscriptions');
    const userDocRef = db.collection('users').doc(uid);

    if (state === 'subscribe') {
        if (!subscription || !subscription.endpoint) {
            throw new functions.https.HttpsError('invalid-argument', 'A valid subscription object must be provided for subscribing.');
        }
        await subsCollection.doc(subscription.endpoint).set(subscription);
        await userDocRef.set({ notificationsEnabled: true, notificationsUpdatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        functions.logger.log(`User ${uid} subscribed for notifications.`);
        return { success: true };
    } 
    
    if (state === 'unsubscribe') {
        if (!subscription || !subscription.endpoint) {
            throw new functions.https.HttpsError('invalid-argument', 'A valid subscription object must be provided for unsubscribing.');
        }
        await subsCollection.doc(subscription.endpoint).delete();
        
        // If it's their last subscription, update their profile
        const remainingSubs = await subsCollection.limit(1).get();
        if (remainingSubs.empty) {
             await userDocRef.set({ notificationsEnabled: false, notificationsUpdatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        }
        functions.logger.log(`User ${uid} unsubscribed from notifications.`);
        return { success: true };
    }

    throw new functions.https.HttpsError('invalid-argument', 'Invalid state provided. Must be "subscribe" or "unsubscribe".');
});

/**
 * Firestore trigger that sends notifications when a shift is written.
 */
export const onShiftWrite = functions.region("europe-west2").firestore.document("shifts/{shiftId}")
    .onWrite(async (change, context) => {
        const settingsDoc = await db.collection('settings').doc('notifications').get();
        if (settingsDoc.exists && settingsDoc.data()?.enabled === false) {
            functions.logger.log('Global notifications are disabled. Aborting.');
            return;
        }

        const shiftId = context.params.shiftId;
        const beforeData = change.before.data();
        const afterData = change.after.data();

        let userId: string | null = null;
        let payload: { title: string; body: string; url: string } | null = null;

        if (!afterData) { // DELETED
             userId = beforeData?.userId;
             payload = {
                title: 'Shift Cancelled',
                body: `Your shift for ${beforeData?.task} at ${beforeData?.address} was cancelled.`,
                url: '/dashboard'
            };
        } else if (!beforeData) { // CREATED
            userId = afterData.userId;
            payload = {
                title: 'New Shift Assigned',
                body: `New shift: ${afterData.task} at ${afterData.address}.`,
                url: '/dashboard?gate=pending'
            };
        } else { // UPDATED
            if (beforeData.userId !== afterData.userId) {
                // Re-assigned to a new user
                userId = afterData.userId;
                 payload = {
                    title: 'New Shift Assigned',
                    body: `A shift was re-assigned to you: ${afterData.task} at ${afterData.address}.`,
                    url: '/dashboard?gate=pending'
                };
            } else {
                // Meaningful change for the same user
                const dateChanged = !beforeData.date.isEqual(afterData.date);
                const taskChanged = beforeData.task !== afterData.task;
                if (dateChanged || taskChanged) {
                    userId = afterData.userId;
                    payload = {
                        title: 'Shift Updated',
                        body: `Details for your shift "${afterData.task}" have been updated.`,
                        url: `/dashboard`
                    };
                }
            }
        }

        if (!userId || !payload) {
            functions.logger.log(`No notification needed for shift write: ${shiftId}`);
            return;
        }

        // Check if user has notifications enabled
        const userDoc = await db.collection('users').doc(userId).get();
        if (userDoc.exists && userDoc.data()?.notificationsEnabled === false) {
            functions.logger.log(`User ${userId} has notifications disabled.`);
            return;
        }
        
        const subsSnapshot = await db.collection('users').doc(userId).collection('pushSubscriptions').get();
        if (subsSnapshot.empty) {
            functions.logger.log(`No push subscriptions found for user ${userId}.`);
            return;
        }

        const notificationPayload = JSON.stringify(payload);
        const promises = subsSnapshot.docs.map(subDoc => {
            const subscription = subDoc.data() as webPush.PushSubscription;
            return webPush.sendNotification(subscription, notificationPayload)
                .catch(error => {
                    functions.logger.error(`Failed to send to ${subscription.endpoint.slice(-10)}`, { statusCode: error.statusCode });
                    // GCM/FCM returns 404 or 410 for expired/invalid subscriptions
                    if (error.statusCode === 404 || error.statusCode === 410) {
                        functions.logger.log(`Deleting invalid subscription for user ${userId}`);
                        return subDoc.ref.delete();
                    }
                });
        });

        await Promise.all(promises);
    });

// Keep existing scheduled functions if any
export const projectReviewNotifier = functions.region("europe-west2").pubsub.schedule("every 24 hours").onRun(async (context) => {
    functions.logger.log("Running daily project review job.");
});

export const pendingShiftNotifier = functions.region("europe-west2").pubsub.schedule("every 1 hours").onRun(async (context) => {
    functions.logger.log("Running hourly pending shift reminder job.");
});
