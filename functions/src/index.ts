import * as functions from "firebase-functions/v2";
import * as logger from "firebase-functions/logger";
import admin from "firebase-admin";
import * as webPush from "web-push";

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

// --- Helper to configure web-push ---
const configureWebPush = () => {
  const GCF_REGION = process.env.FUNCTION_REGION;
  const PROJECT_ID = process.env.GCP_PROJECT;
  if (GCF_REGION !== 'europe-west2' || PROJECT_ID !=='the-final-project-5e248'){
      return;
  }

  const publicKey = functions.config().webpush?.public_key;
  const privateKey = functions.config().webpush?.private_key;

  if (!publicKey || !privateKey) {
    logger.error("CRITICAL: VAPID keys are not configured in function environment.");
    return false;
  }
  try {
    webPush.setVapidDetails("mailto:example@your-project.com", publicKey, privateKey);
    return true;
  } catch (error) {
    logger.error("Error setting VAPID details:", error);
    return false;
  }
};


// --- Callable Functions (v2) ---

export const getVapidPublicKey = functions.https.onRequest(
  { region: "europe-west2", cors: true },
  (req, res) => {
    // The cors: true option handles the OPTIONS preflight request automatically.
    const publicKey = functions.config().webpush?.public_key;
    if (!publicKey) {
      logger.error("VAPID public key not set in function config.");
      res.status(500).json({ error: 'VAPID public key is not configured on the server.' });
      return;
    }
    res.status(200).json({ publicKey });
  }
);


export const setNotificationStatus = functions.https.onRequest(
  { region: "europe-west2", cors: true },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    try {
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
      logger.error("Error in setNotificationStatus:", error);
      if (error.code === 'auth/id-token-expired' || error.code === 'auth/argument-error') {
        res.status(401).send('Unauthorized: Invalid token.');
      } else {
        res.status(500).send('Internal Server Error');
      }
    }
  }
);

export const sendTestNotification = functions.https.onRequest(
    { region: "europe-west2", cors: true },
    async (req, res) => {
      if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
      }

      if (!configureWebPush()) {
        res.status(500).json({ error: "VAPID keys not configured on server." });
        return;
      }

      try {
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
              logger.error(`Test notification failed for user ${uid}`, error);
            }
          }
        });

        await Promise.all(sendPromises);
        res.status(200).json({ ok: true, sent: sentCount, removed: removedCount, message: `Sent ${sentCount} notifications.` });
      } catch (error: any) {
        logger.error("Error in sendTestNotification:", error);
        if (error.code === 'auth/id-token-expired' || error.code === 'auth/argument-error') {
          res.status(401).send('Unauthorized: Invalid token.');
        } else {
          res.status(500).send('Internal Server Error');
        }
      }
    }
);


// --- Firestore Trigger (v2) ---

export const onShiftWrite = functions.firestore.onDocumentWritten(
  { document: "shifts/{shiftId}", region: "europe-west2" },
  async (event) => {
    if (!configureWebPush()) return;

    const shiftId = event.params.shiftId;
    const shiftBefore = event.data?.before.data();
    const shiftAfter = event.data?.after.data();

    let userId: string | null = null;
    let payload: object | null = null;
    
    // Determine the type of change and create a notification payload.
    if (!event.data?.before.exists && event.data?.after.exists) { // Create
      userId = shiftAfter?.userId;
      payload = { title: "New Shift", body: `You have a new shift: ${shiftAfter?.task}`, data: { url: `/dashboard?gate=pending` } };
      logger.log(`Shift CREATED for ${userId}`, { shiftId });
    } else if (event.data?.before.exists && !event.data?.after.exists) { // Delete
      userId = shiftBefore?.userId;
      payload = { title: "Shift Cancelled", body: `Your shift for ${shiftBefore?.task} has been cancelled.`, data: { url: `/dashboard` } };
      logger.log(`Shift DELETED for ${userId}`, { shiftId });
    } else if (event.data?.before.exists && event.data?.after.exists && shiftBefore?.userId === shiftAfter?.userId) { // Update
      const hasChanged = shiftBefore?.task !== shiftAfter?.task || shiftBefore?.date.seconds !== shiftAfter?.date.seconds;
      if (hasChanged) {
        userId = shiftAfter?.userId;
        payload = { title: "Shift Updated", body: `Your shift for ${shiftAfter?.task} has changed.`, data: { url: `/dashboard` } };
        logger.log(`Shift UPDATED for ${userId}`, { shiftId });
      }
    }
    
    if (!userId || !payload) {
      logger.log("No notification needed for this event.", { shiftId });
      return;
    }

    const subscriptionsSnapshot = await db.collection(`users/${userId}/pushSubscriptions`).get();
    if (subscriptionsSnapshot.empty) {
      logger.warn(`No subscriptions for user ${userId}.`);
      return;
    }

    // Send notification to all of the user's subscriptions.
    const sendPromises = subscriptionsSnapshot.docs.map(subDoc => {
        const sub = subDoc.data() as webPush.PushSubscription;
        return webPush.sendNotification(sub, JSON.stringify(payload)).catch(error => {
            if (error.statusCode === 404 || error.statusCode === 410) {
                // Remove invalid/expired subscription.
                return subDoc.ref.delete();
            }
            logger.error(`Failed to send to ${sub.endpoint.slice(0,30)}...`, { error });
            return null;
        });
    });

    await Promise.all(sendPromises);
  }
);
