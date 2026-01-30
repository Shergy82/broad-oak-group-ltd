
import * as functions from 'firebase-functions';
import * as logger from 'firebase-functions/logger';
import admin from 'firebase-admin';
import * as webPush from 'web-push';

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

// --- Helper to configure web-push ---
const configureWebPush = () => {
  const publicKey = functions.config().webpush?.public_key;
  const privateKey = functions.config().webpush?.private_key;

  if (!publicKey || !privateKey) {
    logger.error('CRITICAL: VAPID keys are not configured in function environment.');
    return false;
  }
  try {
    webPush.setVapidDetails('mailto:example@your-project.com', publicKey, privateKey);
    return true;
  } catch (error) {
    logger.error('Error setting VAPID details:', error);
    return false;
  }
};

// --- CORS Middleware for HTTP onRequest functions ---
const handleCors = (req: functions.https.Request, res: functions.Response) => {
  res.set('Access-Control-Allow-Origin', '*'); // In production, restrict this to your app's domain
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return true; // Indicates that the response has been handled
  }
  return false; // Indicates that the request should proceed
};

// --- HTTP Request Functions (v1) ---

export const getVapidPublicKey = functions.region('europe-west2').https.onRequest((req, res) => {
  if (handleCors(req, res)) {
    return;
  }

  const publicKey = functions.config().webpush?.public_key;
  if (!publicKey) {
    logger.error('VAPID public key not set in function config.');
    res.status(500).json({ ok: false, message: 'VAPID public key is not configured on the server.' });
    return;
  }
  res.status(200).json({ publicKey });
});

export const setNotificationStatus = functions.region('europe-west2').https.onRequest(async (req, res) => {
  if (handleCors(req, res)) {
    return;
  }

  const idToken = req.headers.authorization?.split('Bearer ')[1];
  if (!idToken) {
    res.status(401).send('Unauthorized');
    return;
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const uid = decodedToken.uid;
    const { status, subscription, endpoint } = req.body;
    const subsCollection = db.collection('users').doc(uid).collection('pushSubscriptions');

    if (status === 'subscribed') {
      if (!subscription || !subscription.endpoint) {
        throw new functions.https.HttpsError('invalid-argument', 'A valid subscription object is required.');
      }
      const subId = btoa(subscription.endpoint).replace(/=/g, '');
      await subsCollection.doc(subId).set({ ...subscription, createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      res.status(200).json({ ok: true, message: 'Subscribed successfully.' });
    } else if (status === 'unsubscribed') {
      if (!endpoint) {
        throw new functions.https.HttpsError('invalid-argument', 'A subscription endpoint is required to unsubscribe.');
      }
      const subId = btoa(endpoint).replace(/=/g, '');
      await subsCollection.doc(subId).delete();
      res.status(200).json({ ok: true, message: 'Unsubscribed successfully.' });
    } else {
      throw new functions.https.HttpsError('invalid-argument', 'Invalid status provided.');
    }
  } catch (error) {
    logger.error('Error in setNotificationStatus:', error);
    res.status(401).send('Unauthorized');
  }
});


export const sendTestNotification = functions.region('europe-west2').https.onRequest(async (req, res) => {
  if (handleCors(req, res)) {
    return;
  }
  const idToken = req.headers.authorization?.split('Bearer ')[1];
  if (!idToken) {
    res.status(401).send('Unauthorized');
    return;
  }

  if (!configureWebPush()) {
    res.status(500).json({ ok: false, message: 'VAPID keys not configured on server.' });
    return;
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const uid = decodedToken.uid;
    const subscriptionsSnapshot = await db.collection(`users/${uid}/pushSubscriptions`).get();

    if (subscriptionsSnapshot.empty) {
      res.status(200).json({ ok: true, sent: 0, removed: 0, message: 'No subscriptions found for user.' });
      return;
    }

    const payload = JSON.stringify({
      title: 'Test Notification',
      body: 'This is a test notification from your app.',
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
    res.status(200).json({ ok: true, sent: sentCount, removed: removedCount, message: `Sent ${sentCount} notifications.` });
  } catch (error) {
    logger.error("Error in sendTestNotification:", error);
    res.status(401).send('Unauthorized');
  }
});

// --- Firestore Trigger (v1) ---
export const onShiftWrite = functions.region('europe-west2').firestore.document('shifts/{shiftId}').onWrite(async (change, context) => {
  if (!configureWebPush()) return;

  const shiftId = context.params.shiftId;
  const shiftBefore = change.before.data();
  const shiftAfter = change.after.data();

  let userId: string | null = null;
  let payload: object | null = null;

  if (!change.before.exists && change.after.exists) { // Create
    userId = shiftAfter?.userId;
    payload = { title: 'New Shift Assigned', body: `You have a new shift: ${shiftAfter?.task}`, data: { url: `/dashboard?gate=pending` } };
    logger.log(`Shift CREATED for ${userId}`, { shiftId });
  } else if (change.before.exists && !change.after.exists) { // Delete
    userId = shiftBefore?.userId;
    payload = { title: 'Shift Cancelled', body: `Your shift for ${shiftBefore?.task} has been cancelled.`, data: { url: `/dashboard` } };
    logger.log(`Shift DELETED for ${userId}`, { shiftId });
  } else if (change.before.exists && change.after.exists) { // Update
    if (shiftBefore?.userId !== shiftAfter?.userId) {
      // Re-assigned
      const oldUserId = shiftBefore?.userId;
      const newUserId = shiftAfter?.userId;
      if (oldUserId) {
        const oldUserPayload = { title: 'Shift Unassigned', body: `A shift for ${shiftBefore?.task} has been reassigned.`, data: { url: `/dashboard` } };
        await sendNotificationToUser(oldUserId, oldUserPayload);
      }
      if (newUserId) {
        const newUserPayload = { title: 'New Shift Assigned', body: `You have been assigned a shift for ${shiftAfter?.task}.`, data: { url: `/dashboard?gate=pending` } };
        await sendNotificationToUser(newUserId, newUserPayload);
      }
      return;
    }

    userId = shiftAfter?.userId;
    const hasChanged = shiftBefore?.task !== shiftAfter?.task || shiftBefore?.date.seconds !== shiftAfter?.date.seconds || shiftBefore?.address !== shiftAfter?.address || shiftBefore?.type !== shiftAfter?.type;
    if (hasChanged) {
      payload = { title: 'Shift Updated', body: `Your shift for ${shiftAfter?.task} has changed.`, data: { url: `/dashboard` } };
      logger.log(`Shift UPDATED for ${userId}`, { shiftId });
    }
  }

  if (userId && payload) {
    await sendNotificationToUser(userId, payload);
  } else {
    logger.log('No notification needed for this event.', { shiftId });
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
            logger.error(`Failed to send to ${sub.endpoint.slice(0,30)}...`, { error });
            return null;
        });
    });

    await Promise.all(sendPromises);
}
