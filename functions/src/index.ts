
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

export const getVapidPublicKey = functions.region("europe-west2").https.onRequest((req, res) => {
  corsHandler(req, res, () => {
    const publicKey = functions.config().webpush?.public_key;
    if (!publicKey) {
      functions.logger.error("VAPID public key not set in function config.");
      res.status(500).json({ error: 'VAPID public key is not configured on the server.' });
      return;
    }
    res.status(200).json({ publicKey });
  });
});

export const setNotificationStatus = functions.region("europe-west2").https.onRequest(async (req, res) => {
  corsHandler(req, res, async () => {
    try {
      if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
      }

      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).send('Unauthorized: No token provided.');
        return;
      }
      const idToken = authHeader.split('Bearer ')[1];
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      const uid = decodedToken.uid;

      const { status, subscription } = req.body;
      const subsCollection = db.collection('users').doc(uid).collection('pushSubscriptions');

      if (status === 'subscribed') {
        if (!subscription || !subscription.endpoint) {
          res.status(400).json({ error: 'A valid subscription object is required.' });
          return;
        }
        const subId = btoa(subscription.endpoint).replace(/=/g, '');
        await subsCollection.doc(subId).set({ ...subscription, createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        res.status(200).json({ ok: true, message: "Subscribed successfully." });

      } else if (status === 'unsubscribed') {
         if (!subscription || !subscription.endpoint) {
          res.status(400).json({ error: 'A subscription endpoint is required to unsubscribe.' });
          return;
        }
        const subId = btoa(subscription.endpoint).replace(/=/g, '');
        await subsCollection.doc(subId).delete();
        res.status(200).json({ ok: true, message: "Unsubscribed successfully." });

      } else {
        res.status(400).json({ error: 'Invalid status provided.' });
      }
    } catch (error: any) {
      functions.logger.error("Error in setNotificationStatus:", error);
      if (error.code === 'auth/id-token-expired' || error.code === 'auth/argument-error') {
        res.status(401).send('Unauthorized: Invalid token.');
      } else {
        res.status(500).send('Internal Server Error');
      }
    }
  });
});

export const sendTestNotification = functions.region("europe-west2").https.onRequest(async (req, res) => {
    corsHandler(req, res, async () => {
        try {
            if (req.method !== 'POST') {
                res.status(405).send('Method Not Allowed');
                return;
            }

            if (!configureWebPush()) {
                res.status(500).json({ error: "VAPID keys not configured on server."});
                return;
            }

            const authHeader = req.headers.authorization;
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                res.status(401).send('Unauthorized: No token provided.');
                return;
            }
            const idToken = authHeader.split('Bearer ')[1];
            const decodedToken = await admin.auth().verifyIdToken(idToken);
            const uid = decodedToken.uid;

            const subscriptionsSnapshot = await db.collection(`users/${uid}/pushSubscriptions`).get();

            if (subscriptionsSnapshot.empty) {
                res.status(200).json({ ok: true, sent: 0, removed: 0, message: "No subscriptions found for user." });
                return;
            }

            const payload = JSON.stringify({
                title: "Test Notification",
                body: "This is a test notification from your app.",
                data: { url: "/push-debug" }
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
                        functions.logger.error(`Test notification failed for user ${uid}`, error);
                    }
                }
            });

            await Promise.all(sendPromises);
            res.status(200).json({ ok: true, sent: sentCount, removed: removedCount, message: `Sent ${sentCount} notifications.` });
        } catch (error: any) {
            functions.logger.error("Error in sendTestNotification:", error);
            if (error.code === 'auth/id-token-expired' || error.code === 'auth/argument-error') {
                res.status(401).send('Unauthorized: Invalid token.');
            } else {
                res.status(500).send('Internal Server Error');
            }
        }
    });
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
