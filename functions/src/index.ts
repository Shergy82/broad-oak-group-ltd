
'use server';
import * as functions from "firebase-functions";
import admin from "firebase-admin";
import * as webPush from "web-push";

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

export const getVapidPublicKey = functions.region("europe-west2").https.onCall((data, context) => {
    const publicKey = functions.config().webpush?.public_key;
    if (!publicKey) {
        functions.logger.error("CRITICAL: VAPID public key (webpush.public_key) not set in function configuration.");
        throw new functions.https.HttpsError('not-found', 'VAPID public key is not configured on the server.');
    }
    return { publicKey };
});

export const getNotificationStatus = functions.region("europe-west2").https.onCall(async (data, context) => {
    // 1. Authentication check
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "You must be logged in to perform this action.");
    }

    // 2. Authorization check
    const uid = context.auth.uid;
    const userDoc = await db.collection("users").doc(uid).get();
    const userProfile = userDoc.data();
    if (!userProfile || userProfile.role !== 'owner') {
        throw new functions.https.HttpsError("permission-denied", "Only the account owner can view notification settings.");
    }
    
    // 3. Execution
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
    // 1. Authentication check
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "You must be logged in to perform this action.");
    }

    // 2. Authorization check
    const uid = context.auth.uid;
    const enabled = !!data?.enabled;
    const subscription = data?.subscription;

    // Update the user document with their notification preference
    await db.collection("users").doc(uid).set({
        notificationsEnabled: enabled,
        notificationsUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    const userSubscriptionsRef = db.collection("users").doc(uid).collection("pushSubscriptions");

    if (enabled) {
        if (!subscription || !subscription.endpoint) {
          throw new functions.https.HttpsError("invalid-argument", "A valid subscription object is required to subscribe.");
        }
        // Use a hash of the endpoint as the document ID for idempotency
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

export const onShiftWrite = functions.region("europe-west2").firestore.document("shifts/{shiftId}")
  .onWrite(async (change) => {
    // Global notification kill switch
    const settingsDoc = await db.collection('settings').doc('notifications').get();
    if (settingsDoc.exists && settingsDoc.data()?.enabled === false) {
      console.log('Global notifications are disabled. Aborting.');
      return;
    }

    const publicKey = functions.config().webpush?.public_key;
    const privateKey = functions.config().webpush?.private_key;

    if (!publicKey || !privateKey) {
        console.error("CRITICAL: VAPID keys are not configured.");
        return;
    }

    webPush.setVapidDetails("mailto:example@your-project.com", publicKey, privateKey);

    const beforeData = change.before.data();
    const afterData = change.after.data();

    let userId: string | null = null;
    let payload: object | null = null;

    if (change.after.exists && !change.before.exists) { // CREATE
        userId = afterData?.userId;
        payload = {
            title: "New Shift Assigned",
            body: `You have a new shift: ${afterData?.task} at ${afterData?.address}.`,
            url: `/dashboard?gate=pending`,
        };
    } else if (!change.after.exists && change.before.exists) { // DELETE
        userId = beforeData?.userId;
        payload = {
            title: "Shift Cancelled",
            body: `Your shift for ${beforeData?.task} at ${beforeData?.address} has been cancelled.`,
            url: `/dashboard`,
        };
    } else if (change.after.exists && change.before.exists) { // UPDATE
        if (beforeData?.userId !== afterData?.userId) {
            // Re-assignment logic can be added here if needed
        } else if (beforeData?.task !== afterData?.task || beforeData?.address !== afterData?.address || !beforeData?.date.isEqual(afterData?.date)) {
            userId = afterData?.userId;
            payload = {
                title: "Your Shift Has Been Updated",
                body: `The details for one of your shifts have changed.`,
                url: `/dashboard`,
            };
        }
    }

    if (!userId || !payload) {
        return;
    }
    
    // Check user-level notification preference
    const userDoc = await db.collection('users').doc(userId).get();
    if (userDoc.exists && userDoc.data()?.notificationsEnabled === false) {
        console.log(`User ${userId} has disabled notifications. Aborting send.`);
        return;
    }

    const subscriptionsSnapshot = await db.collection("users").doc(userId).collection("pushSubscriptions").withConverter(pushSubscriptionConverter).get();
    if (subscriptionsSnapshot.empty) return;

    const sendPromises = subscriptionsSnapshot.docs.map((subDoc) => {
        const subscription = subDoc.data();
        return webPush.sendNotification(subscription, JSON.stringify(payload)).catch((error: any) => {
            if (error.statusCode === 410 || error.statusCode === 404) {
                return subDoc.ref.delete();
            }
            return null;
        });
    });

    await Promise.all(sendPromises);
});
