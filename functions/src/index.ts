
import * as functions from 'firebase-functions';
import admin from 'firebase-admin';
import * as webPush from 'web-push';
import cors from 'cors';

admin.initializeApp();
const db = admin.firestore();
const corsHandler = cors({ origin: true });


// VAPID keys must be set in Functions config via Firebase CLI
// e.g., firebase functions:config:set webpush.public_key="..." webpush.private_key="..."
const VAPID_PUBLIC_KEY = functions.config().webpush?.public_key;
const VAPID_PRIVATE_KEY = functions.config().webpush?.private_key;

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webPush.setVapidDetails(
        'mailto:example@your-project.com',
        VAPID_PUBLIC_KEY,
        VAPID_PRIVATE_KEY
    );
}

/**
 * Returns the VAPID public key to the client.
 */
export const getVapidPublicKey = functions.region("europe-west2").https.onCall((data, context) => {
    if (!VAPID_PUBLIC_KEY) {
        functions.logger.error("CRITICAL: VAPID public key is not configured in function config.");
        throw new functions.https.HttpsError('failed-precondition', 'The application is not configured for push notifications.');
    }
    return { publicKey: VAPID_PUBLIC_KEY };
});

/**
 * Manages user push subscriptions.
 */
export const managePushSubscription = functions.region("europe-west2").https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated to manage subscriptions.');
    }

    const { subscription, state } = data;
    const uid = context.auth.uid;
    const subsCollection = db.collection('users').doc(uid).collection('pushSubscriptions');
    const userDocRef = db.collection('users').doc(uid);

    if (state === 'subscribe') {
        if (!subscription || !subscription.endpoint) {
            throw new functions.https.HttpsError('invalid-argument', 'A valid subscription object must be provided.');
        }
        await subsCollection.doc(subscription.endpoint).set(subscription);
        await userDocRef.set({ notificationsEnabled: true, notificationsUpdatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        return { success: true, message: "Subscribed successfully." };

    } else if (state === 'unsubscribe') {
        if (!subscription || !subscription.endpoint) {
            throw new functions.https.HttpsError('invalid-argument', 'A valid subscription object must be provided to unsubscribe.');
        }
        await subsCollection.doc(subscription.endpoint).delete();
        
        const remainingSubs = await subsCollection.limit(1).get();
        if (remainingSubs.empty) {
             await userDocRef.set({ notificationsEnabled: false, notificationsUpdatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        }
        return { success: true, message: "Unsubscribed successfully." };

    } else {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid state provided. Must be "subscribe" or "unsubscribe".');
    }
});


/**
 * Firestore trigger that sends notifications when a shift is written.
 */
export const onShiftWrite = functions.region("europe-west2").firestore.document("shifts/{shiftId}")
    .onWrite(async (change, context) => {
        if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
            functions.logger.error("VAPID keys not configured. Cannot send notifications.");
            return;
        }
    
        const shiftId = context.params.shiftId;
        const beforeData = change.before.data();
        const afterData = change.after.data();

        let userId: string | null = null;
        let title: string = '';
        let body: string = '';
        let url: string = '/dashboard';

        if (!afterData) { // DELETED
             userId = beforeData?.userId;
             title = 'Shift Cancelled';
             body = `Your shift for ${beforeData?.task} at ${beforeData?.address} was cancelled.`;
        } else if (!beforeData) { // CREATED
            userId = afterData.userId;
            title = 'New Shift Assigned';
            body = `New shift: ${afterData.task} at ${afterData.address}.`;
            url = '/dashboard?gate=pending';
        } else { // UPDATED
            if (beforeData.userId !== afterData.userId) {
                // Re-assigned to a new user
                userId = afterData.userId;
                title = 'New Shift Assigned';
                body = `A shift was re-assigned to you: ${afterData.task} at ${afterData.address}.`;
                url = '/dashboard?gate=pending';
            } else {
                // Check for meaningful changes for the same user
                const dateChanged = !beforeData.date.isEqual(afterData.date);
                const taskChanged = beforeData.task !== afterData.task;
                const addressChanged = beforeData.address !== afterData.address;
                const typeChanged = beforeData.type !== afterData.type;

                if (dateChanged || taskChanged || addressChanged || typeChanged) {
                    userId = afterData.userId;
                    title = 'Shift Updated';
                    body = `Details for your shift "${afterData.task}" have been updated.`;
                }
            }
        }

        if (!userId) {
            functions.logger.log(`No notification needed for shift write: ${shiftId}`);
            return;
        }
        
        const userDoc = await db.collection('users').doc(userId).get();
        if (!userDoc.exists || userDoc.data()?.notificationsEnabled === false) {
            functions.logger.log(`User ${userId} has notifications disabled.`);
            return;
        }
        
        const subsSnapshot = await db.collection('users').doc(userId).collection('pushSubscriptions').get();
        if (subsSnapshot.empty) {
            functions.logger.log(`No push subscriptions for user ${userId}.`);
            return;
        }

        const payload = JSON.stringify({ title, body, url });
        const promises: Promise<any>[] = [];

        subsSnapshot.forEach(subDoc => {
            const sub = subDoc.data() as webPush.PushSubscription;
            promises.push(
                webPush.sendNotification(sub, payload).catch(error => {
                    functions.logger.error(`Failed to send to ${sub.endpoint.slice(0, 50)}...`, { statusCode: error.statusCode });
                    if (error.statusCode === 404 || error.statusCode === 410) {
                        return subDoc.ref.delete();
                    }
                })
            );
        });

        await Promise.all(promises);
        functions.logger.info(`Successfully processed notifications for shift ${shiftId} for user ${userId}`);
    });
