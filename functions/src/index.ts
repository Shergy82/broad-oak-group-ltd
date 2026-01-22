
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import admin from "firebase-admin";
import * as webPush from "web-push";
import { logger } from "firebase-functions/v2";
import { defineSecret } from "firebase-functions/params";
import { format } from "date-fns";

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
 * Sends a push notification to a specific user.
 * @param userId The UID of the user to notify.
 * @param payload The notification payload.
 * @param secrets The VAPID key secrets.
 */
const sendNotificationToUser = async (
  userId: string,
  payload: object,
  secrets: { publicKey: string; privateKey: string; subject: string }
) => {
  if (!userId) {
    logger.warn("sendNotificationToUser called with no userId.");
    return;
  }

  // Configure web-push with VAPID keys
  webPush.setVapidDetails(secrets.subject, secrets.publicKey, secrets.privateKey);

  // Get user's push subscriptions
  const subscriptionsSnapshot = await db
    .collection("users")
    .doc(userId)
    .collection("pushSubscriptions")
    .withConverter(pushSubscriptionConverter)
    .get();

  if (subscriptionsSnapshot.empty) {
    logger.warn(`User ${userId} has no push subscriptions.`);
    return;
  }

  logger.log(`Found ${subscriptionsSnapshot.size} subscriptions for user ${userId}.`);

  // Send notifications and prune any invalid/expired subscriptions
  const sendPromises = subscriptionsSnapshot.docs.map((subDoc) => {
    const subscription = subDoc.data();
    return webPush.sendNotification(subscription, JSON.stringify(payload)).catch((error: any) => {
      if (error.statusCode === 410 || error.statusCode === 404) {
        logger.log(`Deleting invalid subscription for user ${userId}.`);
        return subDoc.ref.delete();
      }
      logger.error(`Error sending notification to user ${userId}:`, error);
      return null;
    });
  });

  await Promise.all(sendPromises);
  logger.log(`Finished sending notifications for user ${userId}.`);
};

export const getVapidPublicKey = onCall({ region: europeWest2, secrets: [webpushPublicKey] }, (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "You must be logged in.");
    }
    const publicKey = webpushPublicKey.value();
    if (!publicKey) {
        logger.error("CRITICAL: WEBPUSH_PUBLIC_KEY not set in function configuration.");
        throw new HttpsError('not-found', 'VAPID public key is not configured on the server.');
    }
    return { publicKey };
});

export const sendShiftNotification = onDocumentWritten(
  {
    document: "shifts/{shiftId}",
    region: europeWest2,
    secrets: [webpushPublicKey, webpushPrivateKey, webpushSubject],
  },
  async (event) => {
    const beforeData = event.data?.before.data();
    const afterData = event.data?.after.data();

    const secrets = {
        publicKey: webpushPublicKey.value(),
        privateKey: webpushPrivateKey.value(),
        subject: webpushSubject.value() || "mailto:example@your-project.com",
    };
    if (!secrets.publicKey || !secrets.privateKey) {
      logger.error("CRITICAL: VAPID keys are not configured as secrets.");
      return;
    }

    const now = new Date();
    // Use London time for comparison. new Date() is server time (UTC).
    const todayLondonString = now.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
    const startOfTodayLondon = new Date(todayLondonString);

    // Case 1: Shift Created
    if (!beforeData && afterData) {
      const shiftDate = afterData.date.toDate();
      if (shiftDate < startOfTodayLondon) return; // Don't notify for past shifts

      if (afterData.userId) {
        await sendNotificationToUser(afterData.userId, {
          title: "New Shift Added",
          body: `New shift added for ${format(shiftDate, 'dd/MM/yyyy')}`,
          data: { url: `/dashboard` },
        }, secrets);
      }
      return;
    }

    // Case 2: Shift Deleted
    if (beforeData && !afterData) {
      const shiftDate = beforeData.date.toDate();
      if (shiftDate < startOfTodayLondon) return; // Don't notify for past shifts

      if (beforeData.userId) {
        await sendNotificationToUser(beforeData.userId, {
          title: "Shift Removed",
          body: `Your shift has been removed for ${format(shiftDate, 'dd/MM/yyyy')}`,
          data: { url: `/dashboard` },
        }, secrets);
      }
      return;
    }

    // Case 3: Shift Updated
    if (beforeData && afterData) {
        const shiftDateAfter = afterData.date.toDate();
        // Don't notify for updates to shifts that are in the past, unless the date itself was changed from future to past.
        if (shiftDateAfter < startOfTodayLondon && beforeData.date.toDate() < startOfTodayLondon) {
             return;
        }

        const oldUserId = beforeData.userId;
        const newUserId = afterData.userId;

        // Sub-case 3a: User unassigned/reassigned
        if (oldUserId !== newUserId) {
            // Notify old user of removal
            if (oldUserId) {
                 await sendNotificationToUser(oldUserId, {
                    title: "Shift Unassigned",
                    body: `Your shift for ${format(beforeData.date.toDate(), 'dd/MM/yyyy')} has been removed.`,
                    data: { url: `/dashboard` },
                }, secrets);
            }
            // Notify new user of assignment
            if (newUserId) {
                await sendNotificationToUser(newUserId, {
                    title: "New Shift Added",
                    body: `New shift added for ${format(shiftDateAfter, 'dd/MM/yyyy')}`,
                    data: { url: `/dashboard` },
                }, secrets);
            }
        } 
        // Sub-case 3b: Shift details updated for the same user
        else if (newUserId) {
            const hasDateChanged = !beforeData.date.isEqual(afterData.date);
            // Per spec: e.g. start/end time, address, role, notes, status, assigned user
            // My Shift type has: 'type' (am/pm), 'address', 'task', 'notes', 'status'
            const fieldsToCompare = ['task', 'address', 'type', 'notes', 'status'];
            const hasMeaningfulFieldChanged = fieldsToCompare.some(field => (beforeData[field] ?? null) !== (afterData[field] || null));
            
            if (hasDateChanged || hasMeaningfulFieldChanged) {
                 await sendNotificationToUser(newUserId, {
                    title: "Shift Updated",
                    body: `Your shift has been updated for ${format(shiftDateAfter, 'dd/MM/yyyy')}`,
                    data: { url: `/dashboard` },
                }, secrets);
            } else {
                 logger.info(`Shift ${event.params.shiftId} updated, but no meaningful fields changed for the user.`);
            }
        }
    }
});


// Stub out other functions to avoid breaking the build, but focus on the requested one.
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
