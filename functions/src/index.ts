
'use server';
import * as functions from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import * as webPush from "web-push";
import { onDocumentWritten } from "firebase-functions/v2/firestore";

admin.initializeApp();
const db = admin.firestore();

// Define a converter for the PushSubscription type for type safety.
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

// Callable function for the client to get the VAPID public key.
export const getVapidPublicKey = functions.https.onCall({ region: "europe-west2" }, () => {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    if (!publicKey) {
        console.error("CRITICAL: VAPID_PUBLIC_KEY is not set in function environment.");
        throw new functions.https.HttpsError('not-found', 'VAPID public key is not configured on the server.');
    }
    return { publicKey };
});


// Callable function for the client to update their notification subscription status.
export const setNotificationStatus = functions.https.onCall({ region: "europe-west2" }, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) {
        throw new functions.https.HttpsError("unauthenticated", "You must be logged in.");
    }

    const enabled = !!req.data.enabled;
    const subscription = req.data.subscription as webPush.PushSubscription | undefined;

    const userSubscriptionsRef = db.collection("users").doc(uid).collection("pushSubscriptions");

    if (enabled) {
        if (!subscription || !subscription.endpoint) {
            throw new functions.https.HttpsError("invalid-argument", "A valid subscription object is required to subscribe.");
        }
        // Use the endpoint as a reliable, unique identifier for the document.
        const subscriptionDocRef = userSubscriptionsRef.doc(Buffer.from(subscription.endpoint).toString('base64'));
        await subscriptionDocRef.set(pushSubscriptionConverter.toFirestore(subscription));
    } else {
        // Unsubscribe: delete all subscriptions for the user
        const snapshot = await userSubscriptionsRef.get();
        if (!snapshot.empty) {
            const batch = db.batch();
            snapshot.docs.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
        }
    }
    return { success: true };
});


// Firestore trigger that sends notifications on shift changes.
export const onShiftWrite = onDocumentWritten({ document: "shifts/{shiftId}", region: "europe-west2" }, async (event) => {
    const shiftId = event.params.shiftId;
    
    // Global notification kill switch
    const settingsDoc = await db.collection('settings').doc('notifications').get();
    if (settingsDoc.exists && settingsDoc.data()?.enabled === false) {
      console.log('Global notifications are disabled. Aborting.');
      return;
    }

    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;

    if (!publicKey || !privateKey) {
        console.error("CRITICAL: VAPID keys are not configured in environment.");
        return;
    }

    webPush.setVapidDetails("mailto:example@your-project.com", publicKey, privateKey);

    const beforeData = event.data?.before.data();
    const afterData = event.data?.after.data();

    let userId: string | null = null;
    let payload: object | null = null;

    if (event.data?.after.exists && !event.data?.before.exists) { // CREATE
        userId = afterData?.userId;
        payload = {
            title: "New Shift Assigned",
            body: `You have a new shift: ${afterData?.task} at ${afterData?.address}.`,
            data: { url: `/dashboard` },
        };
    } else if (!event.data?.after.exists && event.data?.before.exists) { // DELETE
        userId = beforeData?.userId;
        payload = {
            title: "Shift Cancelled",
            body: `Your shift for ${beforeData?.task} at ${beforeData?.address} has been cancelled.`,
            data: { url: `/dashboard` },
        };
    } else if (event.data?.after.exists && event.data?.before.exists) { // UPDATE
        // Determine if there's a meaningful change that warrants a notification
        if (beforeData?.userId !== afterData?.userId) {
            // Re-assignment logic can be added here if needed
        } else if (beforeData?.task !== afterData?.task || beforeData?.address !== afterData?.address || !beforeData?.date.isEqual(afterData?.date)) {
            userId = afterData?.userId;
            payload = {
                title: "Your Shift Has Been Updated",
                body: `The details for one of your shifts have changed.`,
                data: { url: `/dashboard` },
            };
        }
    }

    if (!userId || !payload) {
        console.log("No notification necessary for this event.");
        return;
    }

    const subscriptionsSnapshot = await db
      .collection("users")
      .doc(userId)
      .collection("pushSubscriptions")
      .withConverter(pushSubscriptionConverter)
      .get();

    if (subscriptionsSnapshot.empty) {
      console.warn(`User ${userId} has no push subscriptions.`);
      return;
    }

    const sendPromises = subscriptionsSnapshot.docs.map((subDoc) => {
        const subscription = subDoc.data();
        return webPush.sendNotification(subscription, JSON.stringify(payload)).catch((error: any) => {
            console.error(`Error sending notification to user ${userId}:`, error);
            if (error.statusCode === 410 || error.statusCode === 404) {
                return subDoc.ref.delete(); // Prune expired/invalid subscription
            }
            return null;
        });
    });

    await Promise.all(sendPromises);
});
