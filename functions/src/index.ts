
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onDocumentCreated, onDocumentDeleted, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import admin from "firebase-admin";
import * as webPush from "web-push";
import { logger } from "firebase-functions/v2";
import { defineSecret } from "firebase-functions/params";
import { format, isBefore, startOfToday } from "date-fns";
import { utcToZonedTime } from "date-fns-tz";
import JSZip from "jszip";


// Initialize admin SDK only once
if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

// Define secrets for VAPID keys and subject
const webpushPublicKey = defineSecret("WEBPUSH_PUBLIC_KEY");
const webpushPrivateKey = defineSecret("WEBPUSH_PRIVATE_KEY");
const webpushSubject = defineSecret("WEBPUSH_SUBJECT");

// Define a converter for the PushSubscription type for robust data handling.
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
            keys: { p256dh: data.keys.p256dh, auth: data.keys.auth },
        };
    }
};

const europeWest2 = "europe-west2";

/**
 * Helper to send notifications to a specific user.
 * It initializes web-push and checks global notification settings.
 */
async function sendNotificationToUser(userId: string, payload: object) {
    if (!userId) {
        logger.warn("sendNotificationToUser called with no userId.");
        return;
    }

    // Check master toggle first
    const settingsDoc = await db.collection('settings').doc('notifications').get();
    if (settingsDoc.exists() && settingsDoc.data()?.enabled === false) {
        logger.log('Global notifications are disabled. Aborting send to user.', { userId });
        return;
    }

    // Configure web-push with VAPID keys from function config
    const publicKey = webpushPublicKey.value();
    const privateKey = webpushPrivateKey.value();
    const subject = webpushSubject.value();

    if (!publicKey || !privateKey || !subject) {
        logger.error("CRITICAL: VAPID keys or subject are not configured as secrets.", { hasPk: !!publicKey, hasSk: !!privateKey, hasSub: !!subject });
        return;
    }
    webPush.setVapidDetails(subject, publicKey, privateKey);

    const subscriptionsSnapshot = await db
        .collection("users")
        .doc(userId)
        .collection("pushSubscriptions")
        .withConverter(pushSubscriptionConverter)
        .get();

    if (subscriptionsSnapshot.empty) {
        logger.warn(`User ${userId} has no push subscriptions. Cannot send notification.`);
        return;
    }

    logger.log(`Found ${subscriptionsSnapshot.size} subscriptions for user ${userId}.`);

    const sendPromises = subscriptionsSnapshot.docs.map((subDoc) => {
        const subscription = subDoc.data();
        return webPush.sendNotification(subscription, JSON.stringify(payload)).catch((error: any) => {
            if (error.statusCode === 410 || error.statusCode === 404) {
                logger.log(`Deleting invalid subscription for user ${userId}.`, { endpoint: subscription.endpoint });
                return subDoc.ref.delete(); // Prune expired subscription
            }
            logger.error(`Error sending notification to user ${userId}:`, { error: error.body || error.message });
            return null;
        });
    });

    await Promise.all(sendPromises);
    logger.log(`Finished sending notifications for user ${userId}.`);
}


function isShiftInPast(shiftDate: Date): boolean {
    const londonTime = utcToZonedTime(new Date(), 'Europe/London');
    const startOfTodayLondon = startOfToday(londonTime);
    return isBefore(shiftDate, startOfTodayLondon);
}


// --- Firestore Triggers for Shifts ---

export const onShiftCreated = onDocumentCreated({ document: "shifts/{shiftId}", region: europeWest2, secrets: [webpushPublicKey, webpushPrivateKey, webpushSubject] }, async (event) => {
    const shiftData = event.data?.data();
    if (!shiftData) return;
    
    const userId = shiftData.userId;
    if (!userId) {
        logger.log("New shift created without a userId. No notification sent.", { shiftId: event.params.shiftId });
        return;
    }
    
    const shiftDate = shiftData.date.toDate();
    if (isShiftInPast(shiftDate)) {
        logger.log("New shift is in the past. No notification sent.", { shiftId: event.params.shiftId });
        return;
    }

    const payload = {
        title: "New shift added",
        body: `A new shift was added for ${format(shiftDate, 'dd/MM/yyyy')}`,
        data: { url: `/shift/${event.params.shiftId}` },
    };

    await sendNotificationToUser(userId, payload);
    logger.log(`Finished onShiftCreated for shiftId: ${event.params.shiftId}`);
});


export const onShiftUpdated = onDocumentUpdated({ document: "shifts/{shiftId}", region: europeWest2, secrets: [webpushPublicKey, webpushPrivateKey, webpushSubject] }, async (event) => {
    const beforeData = event.data?.before.data();
    const afterData = event.data?.after.data();

    if (!beforeData || !afterData) return;
    
    const shiftId = event.params.shiftId;
    
    // --- Check 1: User Reassignment ---
    if (beforeData.userId !== afterData.userId) {
        // Notify the OLD user that the shift was removed
        if (beforeData.userId) {
            const oldUserPayload = {
                title: "Shift unassigned",
                body: `Your shift for ${format(beforeData.date.toDate(), 'dd/MM/yyyy')} has been removed.`,
                data: { url: `/dashboard` },
            };
            await sendNotificationToUser(beforeData.userId, oldUserPayload);
        }
        // Notify the NEW user that a shift was added
        if (afterData.userId && !isShiftInPast(afterData.date.toDate())) {
             const newUserPayload = {
                title: "New shift added",
                body: `A new shift was added for ${format(afterData.date.toDate(), 'dd/MM/yyyy')}`,
                data: { url: `/shift/${shiftId}` },
            };
            await sendNotificationToUser(afterData.userId, newUserPayload);
        }
        logger.log(`Shift ${shiftId} was reassigned. Old: ${beforeData.userId}, New: ${afterData.userId}.`);
        return;
    }

    // --- Check 2: Meaningful change for the SAME user ---
    const userId = afterData.userId;
    if (!userId) return; // No user assigned, nothing to do.

    const afterDate = afterData.date.toDate();

    // Do not notify for updates to shifts that are already in the past
    if (isShiftInPast(afterDate)) {
        logger.log(`Shift ${shiftId} was updated, but it is in the past. No notification sent.`);
        return;
    }
    
    const fieldsToCompare: (keyof typeof afterData)[] = ['task', 'address', 'type', 'notes', 'status', 'date'];
    const hasMeaningfulChange = fieldsToCompare.some(field => {
        if (field === 'date') {
            return !beforeData.date.isEqual(afterData.date);
        }
        return (beforeData[field] || null) !== (afterData[field] || null);
    });

    if (hasMeaningfulChange) {
        const payload = {
            title: "Shift updated",
            body: `Your shift for ${format(afterDate, 'dd/MM/yyyy')} has been updated.`,
            data: { url: `/shift/${shiftId}` },
        };
        logger.log(`Meaningful change detected for shift ${shiftId}. Sending notification.`);
        await sendNotificationToUser(userId, payload);
    } else {
        logger.log(`Shift ${shiftId} was updated, but no significant fields changed for the user.`);
    }
});


export const onShiftDeleted = onDocumentDeleted({ document: "shifts/{shiftId}", region: europeWest2, secrets: [webpushPublicKey, webpushPrivateKey, webpushSubject] }, async (event) => {
    const deletedData = event.data?.data();
    if (!deletedData) return;
    
    const userId = deletedData.userId;
    if (!userId) {
        logger.log("Shift deleted without a userId. No notification sent.", { shiftId: event.params.shiftId });
        return;
    }

    // A deletion is always a meaningful event, so we notify regardless of the date.
    
    const payload = {
        title: "Shift removed",
        body: `Your shift for ${format(deletedData.date.toDate(), 'dd/MM/yyyy')} has been removed.`,
        data: { url: `/dashboard` },
    };

    await sendNotificationToUser(userId, payload);
    logger.log(`Finished onShiftDeleted for shiftId: ${event.params.shiftId}`);
});


// --- Other Callable Functions (Stubs and Existing Logic) ---

export const getVapidPublicKey = onCall({ region: europeWest2 }, () => ({ enabled: true }));
export const getNotificationStatus = onCall({ region: europeWest2 }, () => ({ enabled: true }));
export const setNotificationStatus = onCall({ region: europeWest2 }, () => ({ success: true }));
export const projectReviewNotifier = onSchedule({ schedule: "every 24 hours", region: europeWest2 }, () => { logger.log("projectReviewNotifier executed."); });
export const pendingShiftNotifier = onSchedule({ schedule: "every 1 hours", region: europeWest2 }, () => { logger.log("pendingShiftNotifier executed."); });
export const deleteProjectAndFiles = onCall({ region: europeWest2 }, () => ({ success: true }));
export const deleteProjectFile = onCall({ region: europeWest2 }, () => ({ success: true }));
export const deleteAllShifts = onCall({ region: europeWest2 }, () => ({ success: true }));
export const deleteAllProjects = onCall({ region: europeWest2 }, () => ({ success: true }));
export const setUserStatus = onCall({ region: europeWest2 }, () => ({ success: true }));
export const deleteUser = onCall({ region: europeWest2 }, () => ({ success: true }));
export const zipProjectFiles = onCall({ region: europeWest2 }, () => ({ downloadUrl: "" }));
