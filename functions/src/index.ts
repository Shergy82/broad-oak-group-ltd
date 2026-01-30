
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import * as webPush from 'web-push';
import * as logger from 'firebase-functions/logger';

// Initialize Firebase Admin SDK
if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

// VAPID keys should be set in the Firebase environment
// firebase functions:config:set webpush.public_key="YOUR_KEY"
// firebase functions:config:set webpush.private_key="YOUR_KEY"
const vapidConfig = functions.config().webpush;
if (vapidConfig?.public_key && vapidConfig?.private_key) {
  webPush.setVapidDetails(
    'mailto:example@your-project.com',
    vapidConfig.public_key,
    vapidConfig.private_key
  );
} else {
  logger.warn('VAPID keys not configured. Push notifications will not work.');
}

/**
 * Returns the VAPID public key to the client.
 */
export const getVapidPublicKey = functions
  .region('europe-west2')
  .https.onCall((data, context) => {
    if (!vapidConfig?.public_key) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'VAPID public key is not configured on the server.'
      );
    }
    return { publicKey: vapidConfig.public_key };
  });

/**
 * Saves or deletes a push notification subscription.
 */
export const setNotificationStatus = functions
  .region('europe-west2')
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
    }
    const uid = context.auth.uid;
    const { status, subscription, endpoint } = data;
    const subsCollection = db.collection('users').doc(uid).collection('pushSubscriptions');

    if (status === 'subscribed') {
      if (!subscription?.endpoint) {
        throw new functions.https.HttpsError('invalid-argument', 'A valid subscription object is required.');
      }
      const subId = btoa(subscription.endpoint).replace(/=/g, '');
      await subsCollection.doc(subId).set({
        ...subscription,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      return { ok: true, message: 'Subscribed successfully.' };

    } else if (status === 'unsubscribed') {
      if (!endpoint) {
        throw new functions.https.HttpsError('invalid-argument', 'An endpoint is required to unsubscribe.');
      }
      const subId = btoa(endpoint).replace(/=/g, '');
      await subsCollection.doc(subId).delete();
      return { ok: true, message: 'Unsubscribed successfully.' };

    } else {
      throw new functions.https.HttpsError('invalid-argument', 'Invalid status provided.');
    }
  });

/**
 * Sends a test notification to the authenticated user.
 */
export const sendTestNotification = functions
  .region('europe-west2')
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
    }
    if (!vapidConfig?.public_key) {
      throw new functions.https.HttpsError('failed-precondition', 'VAPID keys not configured.');
    }

    const uid = context.auth.uid;
    const subscriptionsSnapshot = await db.collection(`users/${uid}/pushSubscriptions`).get();

    if (subscriptionsSnapshot.empty) {
      return { ok: true, sent: 0, removed: 0, message: 'No subscriptions found for user.' };
    }

    const payload = JSON.stringify({
      title: 'Test Notification',
      body: 'If you received this, your push notifications are working!',
      data: { url: '/push-debug' },
    });

    let sentCount = 0;
    let removedCount = 0;
    const sendPromises = subscriptionsSnapshot.docs.map(async (subDoc) => {
      const sub = subDoc.data() as webPush.PushSubscription;
      try {
        await webPush.sendNotification(sub, payload);
        sentCount++;
      } catch (error: any) {
        if (error.statusCode === 404 || error.statusCode === 410) {
          await subDoc.ref.delete();
          removedCount++;
        } else {
          logger.error(`Test notification failed for user ${uid}`, error);
        }
      }
    });

    await Promise.all(sendPromises);
    return { ok: true, sent: sentCount, removed: removedCount, message: `Sent ${sentCount} notifications.` };
  });

/**
 * Triggers on any write to a shift document.
 */
export const onShiftWrite = functions
  .region('europe-west2')
  .firestore.document('shifts/{shiftId}')
  .onWrite(async (change, context) => {
    if (!vapidConfig?.public_key) return; // No keys, no notifications

    const shiftId = context.params.shiftId;
    const beforeData = change.before.data();
    const afterData = change.after.data();

    let userId: string | null = null;
    let payload: object | null = null;

    if (!beforeData && afterData) { // Create
      userId = afterData.userId;
      payload = { title: 'New Shift Assigned', body: `You have a new shift: ${afterData.task}`, data: { url: `/dashboard?gate=pending` } };
      logger.log(`Shift CREATED for ${userId}`, { shiftId });
    } else if (beforeData && !afterData) { // Delete
      userId = beforeData.userId;
      payload = { title: 'Shift Cancelled', body: `Your shift for ${beforeData.task} has been cancelled.`, data: { url: `/dashboard` } };
      logger.log(`Shift DELETED for ${userId}`, { shiftId });
    } else if (beforeData && afterData) { // Update
      if (beforeData.userId !== afterData.userId) { // Re-assigned
        if (beforeData.userId) {
          await sendNotificationToUser(beforeData.userId, { title: 'Shift Unassigned', body: `A shift for ${beforeData.task} has been reassigned.`, data: { url: `/dashboard` } });
        }
        if (afterData.userId) {
          await sendNotificationToUser(afterData.userId, { title: 'New Shift Assigned', body: `You have been assigned a shift for ${afterData.task}.`, data: { url: `/dashboard?gate=pending` } });
        }
        return;
      }
      
      const hasChanged = beforeData.task !== afterData.task || beforeData.date.seconds !== afterData.date.seconds || beforeData.address !== afterData.address;
      if (hasChanged) {
        userId = afterData.userId;
        payload = { title: 'Shift Updated', body: `Your shift for ${afterData.task} has changed.`, data: { url: `/dashboard` } };
        logger.log(`Shift UPDATED for ${userId}`, { shiftId });
      }
    }

    if (userId && payload) {
      await sendNotificationToUser(userId, payload);
    }
  });

async function sendNotificationToUser(userId: string, payload: object) {
  const subscriptionsSnapshot = await db.collection(`users/${userId}/pushSubscriptions`).get();
  if (subscriptionsSnapshot.empty) {
    logger.warn(`No subscriptions for user ${userId}.`);
    return;
  }
  const sendPromises = subscriptionsSnapshot.docs.map(subDoc => {
    const sub = subDoc.data() as webPush.PushSubscription;
    return webPush.sendNotification(sub, JSON.stringify(payload)).catch(error => {
      if (error.statusCode === 404 || error.statusCode === 410) {
        return subDoc.ref.delete();
      }
      logger.error(`Failed to send notification to user ${userId}`, { endpoint: sub.endpoint.slice(-10) });
      return null;
    });
  });
  await Promise.all(sendPromises);
}
