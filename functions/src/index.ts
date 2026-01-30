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

    const userRef = db.collection("users").doc(uid);
    await userRef.set({ notificationsEnabled: !!enabled }, { merge: true });

    const subsRef = userRef.collection("pushSubscriptions");
    const existingSubs = await subsRef.get();

    // First, clear out old subscriptions
    if (!existingSubs.empty) {
        const batch = db.batch();
        existingSubs.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
    }

    // If enabling, add the new one
    if (enabled && subscription) {
        const subId = Buffer.from(subscription.endpoint).toString("base64").replace(/=/g, "");
        await subsRef.doc(subId).set({
            ...subscription,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
    }
    return { success: true };
});

export const onShiftWrite = functions.region("europe-west2").firestore.document("shifts/{shiftId}")
  .onWrite(async (change, context) => {
    const functionName = 'onShiftWrite';

    const settingsDoc = await db.collection('settings').doc('notifications').get();
    if (settingsDoc.exists && settingsDoc.data()?.enabled === false) {
      console.log('Global notifications disabled, aborting.');
      return;
    }

    const shiftData = change.after.exists ? change.after.data() : change.before.data();
    if (!shiftData) {
        console.log('No shift data found, aborting.');
        return;
    }

    const userId = shiftData.userId;
    if (!userId) {
        console.log('Shift has no userId, aborting.');
        return;
    }
    
    // Check user's notification preference
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists || userDoc.data()?.notificationsEnabled === false) {
        console.log(`User ${userId} has notifications disabled, aborting.`);
        return;
    }

    const publicKey = functions.config().webpush?.public_key;
    const privateKey = functions.config().webpush?.private_key;

    if (!publicKey || !privateKey) {
        console.error("VAPID keys not configured.");
        return;
    }
    
    webPush.setVapidDetails("mailto:example@example.com", publicKey, privateKey);

    const subscriptionsSnapshot = await db.collection("users").doc(userId).collection("pushSubscriptions").get();
    if (subscriptionsSnapshot.empty) {
        console.log(`No push subscriptions for user ${userId}.`);
        return;
    }

    const payload = JSON.stringify({
        data: {
            title: "Broad Oak Group",
            body: "Your shift schedule has been updated. Please check the app.",
            url: "/dashboard"
        }
    });

    const sendPromises = subscriptionsSnapshot.docs.map(subDoc => {
        const sub = subDoc.data() as webPush.PushSubscription;
        return webPush.sendNotification(sub, payload).catch(async (error) => {
            console.error(`Failed to send to ${sub.endpoint}:`, error.body);
            if (error.statusCode === 404 || error.statusCode === 410) {
                await subDoc.ref.delete(); // Prune stale subscription
            }
        });
    });

    await Promise.all(sendPromises);
  });
