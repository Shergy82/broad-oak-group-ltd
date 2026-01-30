
import * as functions from "firebase-functions";
import admin from "firebase-admin";
import * as webPush from "web-push";
import cors from "cors";

const corsHandler = cors({ origin: true });

admin.initializeApp();
const db = admin.firestore();

// --- LOGGING HELPER ---
const logToFirestore = (
  functionName: string,
  level: 'info' | 'warn' | 'error',
  message: string,
  details: { shiftId?: string; userId?: string; payload?: any } = {}
) => {
  if (level === 'error') {
    functions.logger.error(`[${functionName}] ${message}`, details);
  } else if (level === 'warn') {
    functions.logger.warn(`[${functionName}] ${message}`, details);
  } else {
    functions.logger.info(`[${functionName}] ${message}`, details);
  }

  return db.collection('function_logs').add({
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    functionName,
    level,
    message,
    ...details,
  }).catch(e => {
    functions.logger.error("Failed to write log to Firestore:", e);
  });
};


export const getVapidPublicKey = functions.region("europe-west2").https.onCall((data, context) => {
    const publicKey = functions.config().webpush?.public_key;
    if (!publicKey) {
        functions.logger.error("CRITICAL: VAPID public key not set in function config.");
        throw new functions.https.HttpsError('not-found', 'VAPID public key is not configured.');
    }
    return { publicKey };
});

export const setNotificationStatus = functions.region("europe-west2").https.onCall(async (data, context) => {
    const functionName = 'setNotificationStatus';
    if (!context.auth) {
        await logToFirestore(functionName, 'error', 'Unauthenticated attempt to set notification status.');
        throw new functions.https.HttpsError("unauthenticated", "You must be logged in.");
    }
    const uid = context.auth.uid;
    const { enabled, subscription } = data;

    await logToFirestore(functionName, 'info', `User attempting to set status.`, { userId: uid, payload: { enabled } });

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
        await logToFirestore(functionName, 'info', 'Subscription saved.', { userId: uid });
    } else if (!enabled && subscription?.endpoint) {
        const subId = Buffer.from(subscription.endpoint).toString("base64").replace(/=/g, "");
        await subsRef.doc(subId).delete().catch(() => {});
        await logToFirestore(functionName, 'info', 'Specific subscription deleted.', { userId: uid });
    } else if (!enabled && !subscription) {
        await logToFirestore(functionName, 'warn', 'User disabled notifications globally, but no specific subscription was provided to delete.', { userId: uid });
    }

    return { success: true };
});

// Changed to onCreate for simplicity and reliable debugging
export const onShiftWrite = functions.region("europe-west2").firestore.document("shifts/{shiftId}")
  .onCreate(async (snap, context) => {
    const functionName = 'onShiftWrite_onCreate';
    const shiftId = context.params.shiftId;
    const shiftData = snap.data();

    await logToFirestore(functionName, 'info', 'Function triggered for new shift.', { shiftId });

    if (!shiftData) {
        await logToFirestore(functionName, 'warn', 'No shift data found, aborting.', { shiftId });
        return;
    }
    
    const userId = shiftData.userId;
    if (!userId) {
        await logToFirestore(functionName, 'warn', 'Shift has no userId, aborting.', { shiftId });
        return;
    }
    
    // 1. Global Kill Switch Check
    const settingsDoc = await db.collection('settings').doc('notifications').get();
    if (settingsDoc.exists && settingsDoc.data()?.enabled === false) {
      await logToFirestore(functionName, 'info', 'Global notifications are disabled, aborting.', { shiftId, userId });
      return;
    }

    // 2. User-specific Preference Check
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists || userDoc.data()?.notificationsEnabled === false) {
        await logToFirestore(functionName, 'info', 'User has notifications disabled, aborting.', { shiftId, userId });
        return;
    }
    
    // 3. VAPID Key Check
    const publicKey = functions.config().webpush?.public_key;
    const privateKey = functions.config().webpush?.private_key;

    if (!publicKey || !privateKey) {
        await logToFirestore(functionName, 'error', 'VAPID keys not configured. Cannot send notification.', { shiftId, userId });
        return;
    }
    
    webPush.setVapidDetails("mailto:example@example.com", publicKey, privateKey);
    await logToFirestore(functionName, 'info', 'VAPID details set.', { shiftId, userId });


    // 4. Fetch Subscriptions
    const subscriptionsSnapshot = await db.collection("users").doc(userId).collection("pushSubscriptions").get();
    if (subscriptionsSnapshot.empty) {
        await logToFirestore(functionName, 'warn', 'No push subscriptions for user.', { shiftId, userId });
        return;
    }

    await logToFirestore(functionName, 'info', `Found ${subscriptionsSnapshot.size} subscriptions for user.`, { shiftId, userId });

    // 5. Send Notifications
    const payload = JSON.stringify({
        title: 'New Shift Assigned',
        body: `You have a new shift: ${shiftData.task} at ${shiftData.address}.`,
        data: { url: "/dashboard" }
    });

    const sendPromises = subscriptionsSnapshot.docs.map(subDoc => {
        const sub = subDoc.data() as webPush.PushSubscription;
        
        return webPush.sendNotification(sub, payload).then(async () => {
            await logToFirestore(functionName, 'info', `Successfully sent notification for shift.`, { shiftId, userId });
        }).catch(async (error) => {
            await logToFirestore(functionName, 'error', `Failed to send notification. Error: ${error.body || error.message}`, { shiftId, userId, payload: { endpoint: sub.endpoint, statusCode: error.statusCode } });
            
            if (error.statusCode === 404 || error.statusCode === 410) {
                await logToFirestore(functionName, 'warn', 'Subscription is stale, deleting it.', { shiftId, userId });
                return subDoc.ref.delete(); // Prune stale subscription
            }
        });
    });

    await Promise.all(sendPromises);
  });
