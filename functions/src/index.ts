
import * as functions from "firebase-functions";
import admin from "firebase-admin";
import * as webPush from "web-push";
import cors from 'cors';

const corsHandler = cors({ origin: true });

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const configureWebPush = () => {
  const config = functions.config();
  const publicKey = config.webpush?.public_key;
  const privateKey = config.webpush?.private_key;
  const mailto = config.webpush?.subject || 'mailto:example@your-project.com';

  if (!publicKey || !privateKey) {
    functions.logger.error("CRITICAL: VAPID keys are not configured.");
    return false;
  }

  try {
    webPush.setVapidDetails(mailto, publicKey, privateKey);
    return true;
  } catch (error) {
    functions.logger.error("Error setting VAPID details:", error);
    return false;
  }
};

export const getVapidPublicKey = functions.region("europe-west2").https.onCall((data, context) => {
    const publicKey = functions.config().webpush?.public_key;
    if (!publicKey) {
        functions.logger.error("VAPID public key not set.");
        throw new functions.https.HttpsError('not-found', 'VAPID public key is not configured.');
    }
    return { publicKey };
});

export const setNotificationStatus = functions.region("europe-west2").https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Authentication required.");
  }
  const uid = context.auth.uid;
  const { status, subscription } = data;
  const subsCollection = db.collection('users').doc(uid).collection('pushSubscriptions');
  
  if (status === 'subscribed') {
    if (!subscription || !subscription.endpoint) {
      throw new functions.https.HttpsError('invalid-argument', 'A valid subscription object is required.');
    }
    const subId = btoa(subscription.endpoint).replace(/=/g, '');
    await subsCollection.doc(subId).set({ ...subscription }, { merge: true });
    return { ok: true, message: "Subscribed successfully." };
  } else if (status === 'unsubscribed') {
    if (!subscription || !subscription.endpoint) {
      throw new functions.https.HttpsError('invalid-argument', 'A subscription endpoint is required to unsubscribe.');
    }
    const subId = btoa(subscription.endpoint).replace(/=/g, '');
    await subsCollection.doc(subId).delete();
    return { ok: true, message: "Unsubscribed successfully." };
  } else {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid status provided.');
  }
});

export const onShiftWrite = functions.region("europe-west2").firestore.document("shifts/{shiftId}")
  .onWrite(async (change, context) => {
    if (!configureWebPush()) return;
    
    const shiftId = context.params.shiftId;
    const shiftBefore = change.before.data();
    const shiftAfter = change.after.data();

    let userId: string | null = null;
    let payload: object | null = null;
    
    if (!change.before.exists && change.after.exists) {
      userId = shiftAfter?.userId;
      payload = { title: "New Shift", body: `You have a new shift: ${shiftAfter?.task}`, data: { url: `/dashboard?gate=pending` } };
      functions.logger.log(`Shift CREATED for ${userId}`, { shiftId });
    } else if (change.before.exists && !change.after.exists) {
      userId = shiftBefore?.userId;
      payload = { title: "Shift Cancelled", body: `Your shift for ${shiftBefore?.task} has been cancelled.`, data: { url: `/dashboard` } };
      functions.logger.log(`Shift DELETED for ${userId}`, { shiftId });
    } else if (change.before.exists && change.after.exists && shiftBefore?.userId === shiftAfter?.userId) {
      const hasChanged = shiftBefore?.task !== shiftAfter?.task || shiftBefore?.date.seconds !== shiftAfter?.date.seconds;
      if (hasChanged) {
        userId = shiftAfter?.userId;
        payload = { title: "Shift Updated", body: `Your shift for ${shiftAfter?.task} has changed.`, data: { url: `/dashboard` } };
        functions.logger.log(`Shift UPDATED for ${userId}`, { shiftId });
      }
    }
    
    if (!userId || !payload) {
      functions.logger.log("No notification needed for this event.", { shiftId });
      return;
    }

    const subscriptionsSnapshot = await db.collection(`users/${userId}/pushSubscriptions`).get();
    if (subscriptionsSnapshot.empty) {
      functions.logger.warn(`No subscriptions for user ${userId}.`);
      return;
    }

    const sendPromises = subscriptionsSnapshot.docs.map(subDoc => {
        const sub = subDoc.data() as webPush.PushSubscription;
        return webPush.sendNotification(sub, JSON.stringify(payload)).catch(error => {
            if (error.statusCode === 404 || error.statusCode === 410) {
                return subDoc.ref.delete();
            }
            functions.logger.error(`Failed to send to ${sub.endpoint.slice(0,30)}...`, { error });
            return null;
        });
    });

    await Promise.all(sendPromises);
  });

export const sendTestNotification = functions.region("europe-west2").https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Authentication required.");
  }
  if (!configureWebPush()) {
    throw new functions.https.HttpsError("failed-precondition", "VAPID keys not configured.");
  }

  const userId = context.auth.uid;
  const subscriptionsSnapshot = await db.collection(`users/${userId}/pushSubscriptions`).get();

  if (subscriptionsSnapshot.empty) {
    return { ok: true, sent: 0, message: "No subscriptions found." };
  }

  const payload = JSON.stringify({
    title: "Test Notification",
    body: "This is a test notification from the app.",
    data: { url: "/push-debug" }
  });

  let sentCount = 0;
  const sendPromises = subscriptionsSnapshot.docs.map(async (subDoc) => {
    const sub = subDoc.data() as webPush.PushSubscription;
    try {
      await webPush.sendNotification(sub, payload);
      sentCount++;
    } catch (error: any) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        await subDoc.ref.delete();
      } else {
        functions.logger.error(`Test notification failed for user ${userId}`, error);
      }
    }
  });

  await Promise.all(sendPromises);
  return { ok: true, sent: sentCount, message: `Sent ${sentCount} test notifications.` };
});
