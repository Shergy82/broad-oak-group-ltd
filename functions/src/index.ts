import * as functions from "firebase-functions";
import admin from "firebase-admin";
import * as webPush from "web-push";
import { onDocumentCreated } from 'firebase-functions/v2/firestore';


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

async function logToFirestore(level: 'info' | 'warn' | 'error', functionName: string, message: string, context: any = {}) {
    try {
        await db.collection('function_logs').add({
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            level,
            functionName,
            message,
            ...context
        });
    } catch (e) {
        functions.logger.error("FATAL: Could not write to function_logs collection:", e);
    }
}


export const getVapidPublicKey = functions.region("europe-west2").https.onCall((data, context) => {
    const publicKey = functions.config().webpush?.public_key;
    if (!publicKey) {
        functions.logger.error("CRITICAL: VAPID public key (webpush.public_key) not set in function configuration.");
        throw new functions.https.HttpsError('not-found', 'VAPID public key is not configured on the server.');
    }
    return { publicKey };
});

export const getNotificationStatus = functions.region("europe-west2").https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "You must be logged in to perform this action.");
    }
    const uid = context.auth.uid;
    const userDoc = await db.collection("users").doc(uid).get();
    if (!userDoc.exists) {
         throw new functions.https.HttpsError("not-found", "User profile not found.");
    }
    const userProfile = userDoc.data();
    if (userProfile?.role !== 'owner') {
        throw new functions.https.HttpsError("permission-denied", "Only the account owner can view notification settings.");
    }
    
    try {
        const settingsRef = db.collection('settings').doc('notifications');
        const docSnap = await settingsRef.get();
        if (docSnap.exists && docSnap.data()?.enabled === false) {
            return { enabled: false };
        }
        return { enabled: true }; // Default to enabled
    } catch (error) {
        functions.logger.error("Error reading notification settings:", error);
        throw new functions.https.HttpsError("internal", "An unexpected error occurred while reading the settings.");
    }
});


export const setNotificationStatus = functions.region("europe-west2").https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "You must be logged in to perform this action.");
    }

    const uid = context.auth.uid;
    const enabled = !!data?.enabled;
    const subscription = data?.subscription;

    await db.collection("users").doc(uid).set({
        notificationsEnabled: enabled,
        notificationsUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    const userSubscriptionsRef = db.collection("users").doc(uid).collection("pushSubscriptions");

    if (enabled) {
        if (!subscription || !subscription.endpoint) {
          throw new functions.https.HttpsError("invalid-argument", "A valid subscription object is required to subscribe.");
        }
        const docId = Buffer.from(subscription.endpoint).toString("base64").replace(/=/g, "");
        await userSubscriptionsRef.doc(docId).set({
          endpoint: subscription.endpoint,
          keys: subscription.keys,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          userAgent: data.userAgent || ''
        });
    } else {
        const snap = await userSubscriptionsRef.get();
        if (!snap.empty) {
            const batch = db.batch();
            snap.docs.forEach((d) => batch.delete(d.ref));
            await batch.commit();
        }
    }
    return { success: true };
});

export const onShiftCreatedForNotification = onDocumentCreated("shifts/{shiftId}", async (event) => {
    const shiftId = event.params.shiftId;
    const functionName = 'onShiftCreatedForNotification';
    
    await logToFirestore('info', functionName, 'Function triggered.', { shiftId });

    const settingsDoc = await db.collection('settings').doc('notifications').get();
    if (settingsDoc.exists && settingsDoc.data()?.enabled === false) {
      await logToFirestore('warn', functionName, 'Global notifications are disabled. Aborting.', { shiftId });
      return;
    }

    const publicKey = functions.config().webpush?.public_key;
    const privateKey = functions.config().webpush?.private_key;

    if (!publicKey || !privateKey) {
        await logToFirestore('error', functionName, 'CRITICAL: VAPID keys are not configured in functions environment.', { shiftId });
        return;
    }
    await logToFirestore('info', functionName, 'VAPID keys loaded from config.', { shiftId, publicKeyPresent: !!publicKey, privateKeyPresent: !!privateKey });

    webPush.setVapidDetails("mailto:example@your-project.com", publicKey, privateKey);

    const shiftData = event.data?.data();
    if (!shiftData) {
        await logToFirestore('warn', functionName, 'No data in created shift document.', { shiftId });
        return;
    }

    const { userId, task, address } = shiftData;

    if (!userId) {
        await logToFirestore('warn', functionName, 'Shift created without a userId.', { shiftId });
        return;
    }
    
    await logToFirestore('info', functionName, 'Processing notification for user.', { shiftId, userId });

    const userDoc = await db.collection('users').doc(userId).get();
    if (userDoc.exists && userDoc.data()?.notificationsEnabled === false) {
        await logToFirestore('info', functionName, 'User has disabled notifications. Aborting.', { shiftId, userId });
        return;
    }

    const subscriptionsSnapshot = await db.collection("users").doc(userId).collection("pushSubscriptions").withConverter(pushSubscriptionConverter).get();
    if (subscriptionsSnapshot.empty) {
        await logToFirestore('warn', functionName, 'User has no push subscriptions.', { shiftId, userId });
        return;
    }
    
    await logToFirestore('info', functionName, `Found ${subscriptionsSnapshot.size} subscriptions for user.`, { shiftId, userId });

    const payload = JSON.stringify({
        title: "New Shift Assigned",
        body: `You have a new shift: ${task} at ${address}.`,
        data: { url: `/dashboard` },
    });

    const sendPromises = subscriptionsSnapshot.docs.map(async (subDoc) => {
        const subscription = subDoc.data();
        await logToFirestore('info', functionName, 'Attempting to send notification.', { shiftId, userId, endpoint: subscription.endpoint });
        try {
            await webPush.sendNotification(subscription, payload);
            await logToFirestore('info', functionName, 'Successfully sent notification.', { shiftId, userId, endpoint: subscription.endpoint });
        } catch (error: any) {
            await logToFirestore('error', functionName, 'web-push.sendNotification failed.', { 
                shiftId, 
                userId, 
                endpoint: subscription.endpoint, 
                error: {
                    message: error.message,
                    statusCode: error.statusCode,
                    body: error.body
                }
            });

            if (error.statusCode === 404 || error.statusCode === 410) {
                await logToFirestore('info', functionName, 'Subscription is stale, deleting.', { shiftId, userId, endpoint: subscription.endpoint });
                await subDoc.ref.delete();
            }
        }
    });

    await Promise.all(sendPromises);
    await logToFirestore('info', functionName, 'Finished processing all subscriptions for shift.', { shiftId, userId });
});
