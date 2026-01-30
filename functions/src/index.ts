
import * as functions from 'firebase-functions';
import admin from 'firebase-admin';
import * as webPush from 'web-push';

admin.initializeApp();
const db = admin.firestore();

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
            keys: { p256dh: data.keys.p256dh, auth: data.keys.auth }
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


export const setNotificationStatus = functions.region("europe-west2").https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "You must be logged in.");
    }
    const uid = context.auth.uid;
    const { enabled, subscription } = data;

    const userRef = db.collection("users").doc(uid);
    await userRef.set({ 
        notificationsEnabled: !!enabled,
        notificationsUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    const subsRef = userRef.collection("pushSubscriptions");

    if (enabled && subscription?.endpoint) {
        const subId = Buffer.from(subscription.endpoint).toString("base64").replace(/=/g, "");
        await subsRef.doc(subId).set({
            ...subscription,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
    } else if (!enabled && subscription?.endpoint) {
        const subId = Buffer.from(subscription.endpoint).toString("base64").replace(/=/g, "");
        await subsRef.doc(subId).delete().catch(() => {});
    }

    return { success: true };
});

export const onShiftWrite = functions.region("europe-west2").firestore.document("shifts/{shiftId}")
  .onWrite(async (change, context) => {
    const shiftId = context.params.shiftId;
    
    const beforeData = change.before.data();
    const afterData = change.after.data();

    let userId: string | null = null;
    let payload: { notification: { title: string; body: string; }; data: { url: string; }; } | null = null;
    let logMessage: string = "";

    // Case 1: Shift Created
    if (!beforeData && afterData) {
        userId = afterData.userId;
        payload = {
            notification: {
                title: "New Shift Assigned",
                body: `You have a new shift: ${afterData.task} at ${afterData.address}.`
            },
            data: { url: "/dashboard?gate=pending" }
        };
        logMessage = `Shift created: ${shiftId} for user ${userId}`;
    }
    // Case 2: Shift Updated
    else if (beforeData && afterData) {
        const meaningfulChange = beforeData.task !== afterData.task || beforeData.address !== afterData.address || !beforeData.date.isEqual(afterData.date);
        
        if (afterData.userId !== beforeData.userId) {
            userId = afterData.userId;
            payload = {
                notification: {
                    title: "New Shift Assigned",
                    body: `A shift was re-assigned to you: ${afterData.task} at ${afterData.address}.`
                },
                data: { url: "/dashboard?gate=pending" }
            };
            logMessage = `Shift ${shiftId} re-assigned to user ${userId}`;
        } else if (meaningfulChange) {
            userId = afterData.userId;
            payload = {
                notification: {
                    title: "Shift Updated",
                    body: `Your shift for ${afterData.task} has been updated.`
                },
                data: { url: "/dashboard" }
            };
            logMessage = `Shift updated: ${shiftId} for user ${userId}`;
        } else {
             functions.logger.info(`Shift write event for ${shiftId}, but no meaningful change detected.`);
             return; // No meaningful change, so no notification.
        }
    }
    else { // Shift deleted
        functions.logger.info(`Shift deleted: ${shiftId}. No notification sent.`);
        return;
    }

    if (!userId || !payload) {
      functions.logger.info(`No user or payload for shift ${shiftId}. Aborting.`);
      return;
    }
    
    functions.logger.info(logMessage);

    try {
        const userDoc = await db.collection('users').doc(userId).get();
        if (userDoc.data()?.notificationsEnabled === false) {
            functions.logger.info(`User ${userId} has notifications disabled.`);
            return;
        }

        const publicKey = functions.config().webpush?.public_key;
        const privateKey = functions.config().webpush?.private_key;
        if (!publicKey || !privateKey) {
            functions.logger.error("VAPID keys not configured.");
            return;
        }

        webPush.setVapidDetails("mailto:example@example.com", publicKey, privateKey);
        
        const subscriptionsSnapshot = await db.collection("users").doc(userId).collection("pushSubscriptions").withConverter(pushSubscriptionConverter).get();
        if (subscriptionsSnapshot.empty) {
            functions.logger.warn(`No subscriptions found for user ${userId}.`);
            return;
        }

        const sendPromises = subscriptionsSnapshot.docs.map(subDoc => {
            const sub = subDoc.data();
            return webPush.sendNotification(sub, JSON.stringify(payload))
                .catch(error => {
                    functions.logger.error(`Failed to send notification to ${sub.endpoint.slice(0,50)}...`, error);
                    if (error.statusCode === 404 || error.statusCode === 410) {
                        return subDoc.ref.delete(); // Prune stale subscription
                    }
                });
        });

        await Promise.all(sendPromises);
        functions.logger.info(`Successfully processed notifications for shift ${shiftId}`);

    } catch (error) {
        functions.logger.error(`Error sending notification for user ${userId}:`, error);
    }
});
