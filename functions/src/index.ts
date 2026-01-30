
import * as functions from "firebase-functions";
import admin from "firebase-admin";
import * as webPush from "web-push";
import cors from "cors";

const corsHandler = cors({ origin: true });

admin.initializeApp();
const db = admin.firestore();

export const getVapidPublicKey = functions.region("europe-west2").https.onCall((data, context) => {
    const publicKey = functions.config().webpush?.public_key;
    if (!publicKey) {
        functions.logger.error("CRITICAL: VAPID public key not set in function config.");
        throw new functions.https.HttpsError('not-found', 'VAPID public key is not configured.');
    }
    return { publicKey };
});

export const setNotificationStatus = functions.region("europe-west2").https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "You must be logged in.");
    }
    const uid = context.auth.uid;
    const { enabled, subscription } = data;

    // Set the user-level preference
    const userRef = db.collection("users").doc(uid);
    await userRef.set({ notificationsEnabled: !!enabled }, { merge: true });

    const subsRef = userRef.collection("pushSubscriptions");

    if (enabled && subscription?.endpoint) {
        // If enabling, add/update the new subscription
        const subId = Buffer.from(subscription.endpoint).toString("base64").replace(/=/g, "");
        await subsRef.doc(subId).set({
            ...subscription,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
    } else if (!enabled && subscription?.endpoint) {
        // If disabling with a specific subscription, remove just that one
        const subId = Buffer.from(subscription.endpoint).toString("base64").replace(/=/g, "");
        await subsRef.doc(subId).delete().catch(() => {});
    } else if (!enabled && !subscription) {
        // If disabling without a specific subscription (e.g., from a different browser),
        // we can't delete a specific one, but the user's preference is now `false`.
        functions.logger.log(`User ${uid} disabled notifications globally, but no specific subscription was provided to delete.`);
    }

    return { success: true };
});

export const onShiftWrite = functions.region("europe-west2").firestore.document("shifts/{shiftId}")
  .onWrite(async (change, context) => {
    const functionName = 'onShiftWrite';

    // 1. Global Kill Switch Check
    const settingsDoc = await db.collection('settings').doc('notifications').get();
    if (settingsDoc.exists && settingsDoc.data()?.enabled === false) {
      functions.logger.info(`[${functionName}] Global notifications disabled, aborting.`);
      return;
    }

    const shiftDataAfter = change.after.exists ? change.after.data() : null;
    const shiftDataBefore = change.before.exists ? change.before.data() : null;

    const shiftData = shiftDataAfter || shiftDataBefore;
    if (!shiftData) {
        functions.logger.warn(`[${functionName}] No shift data found, aborting.`);
        return;
    }

    const userId = shiftData.userId;
    if (!userId) {
        functions.logger.info(`[${functionName}] Shift has no userId, aborting.`);
        return;
    }
    
    // 2. User-specific Preference Check
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists || userDoc.data()?.notificationsEnabled === false) {
        functions.logger.info(`[${functionName}] User ${userId} has notifications disabled, aborting.`);
        return;
    }
    
    // Determine notification type
    let title = '';
    let body = '';
    
    if (change.after.exists && !change.before.exists) {
        title = 'New Shift Assigned';
        body = `You have a new shift: ${shiftDataAfter?.task} at ${shiftDataAfter?.address}.`;
    } else if (change.after.exists && change.before.exists) {
        title = 'Shift Updated';
        body = `Your shift for ${shiftDataAfter?.task} has been updated.`;
    } else if (!change.after.exists && change.before.exists) {
        title = 'Shift Cancelled';
        body = `Your shift for ${shiftDataBefore?.task} at ${shiftDataBefore?.address} has been cancelled.`;
    }

    if (!title) {
        functions.logger.info(`[${functionName}] No relevant change detected for notification.`);
        return;
    }

    // 3. VAPID Key Check
    const publicKey = functions.config().webpush?.public_key;
    const privateKey = functions.config().webpush?.private_key;

    if (!publicKey || !privateKey) {
        functions.logger.error(`[${functionName}] VAPID keys not configured. Cannot send notification.`);
        return;
    }
    
    webPush.setVapidDetails("mailto:example@example.com", publicKey, privateKey);

    // 4. Fetch Subscriptions
    const subscriptionsSnapshot = await db.collection("users").doc(userId).collection("pushSubscriptions").get();
    if (subscriptionsSnapshot.empty) {
        functions.logger.info(`[${functionName}] No push subscriptions for user ${userId}.`);
        return;
    }

    // 5. Send Notifications
    const payload = JSON.stringify({
        title,
        body,
        url: "/dashboard" // Direct all notifications to the dashboard for simplicity
    });

    const sendPromises = subscriptionsSnapshot.docs.map(subDoc => {
        const sub = subDoc.data() as webPush.PushSubscription;
        functions.logger.info(`[${functionName}] Attempting to send notification to endpoint for user ${userId}`);
        return webPush.sendNotification(sub, payload).catch(async (error) => {
            functions.logger.error(`[${functionName}] Failed to send to ${sub.endpoint}:`, error.body);
            if (error.statusCode === 404 || error.statusCode === 410) {
                functions.logger.warn(`[${functionName}] Subscription is stale, deleting it.`);
                await subDoc.ref.delete(); // Prune stale subscription
            }
        });
    });

    await Promise.all(sendPromises);
    functions.logger.info(`[${functionName}] Finished sending notifications for user ${userId}.`);
  });
