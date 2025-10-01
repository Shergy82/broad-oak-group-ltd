
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import * as webPush from "web-push";

admin.initializeApp();
const db = admin.firestore();

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
            keys: {
                p256dh: data.keys.p256dh,
                auth: data.keys.auth
            }
        };
    }
};

// Callable function to securely provide the VAPID public key to the client.
export const getVapidPublicKey = functions.region("europe-west2").https.onCall((data, context) => {
    const publicKey = functions.config().webpush?.public_key;
    if (!publicKey) {
        functions.logger.error("CRITICAL: VAPID public key (webpush.public_key) not set in function configuration.");
        throw new functions.https.HttpsError('not-found', 'VAPID public key is not configured on the server.');
    }
    return { publicKey };
});

// Callable function for the owner to check the global notification status.
export const getNotificationStatus = functions.region("europe-west2").https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "You must be logged in.");
    }
    const userDoc = await db.collection("users").doc(context.auth.uid).get();
    if (userDoc.data()?.role !== 'owner') {
        throw new functions.https.HttpsError("permission-denied", "Only the owner can view settings.");
    }
    
    const settingsDoc = await db.collection('settings').doc('notifications').get();
    return { enabled: settingsDoc.exists && settingsDoc.data()?.enabled !== false };
});

// Callable function for the owner to enable/disable all notifications globally.
export const setNotificationStatus = functions.region("europe-west2").https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "You must be logged in.");
    }
    const userDoc = await db.collection("users").doc(context.auth.uid).get();
    if (userDoc.data()?.role !== 'owner') {
        throw new functions.https.HttpsError("permission-denied", "Only the owner can change settings.");
    }
    if (typeof data.enabled !== 'boolean') {
        throw new functions.https.HttpsError("invalid-argument", "The 'enabled' field must be a boolean.");
    }
    
    await db.collection('settings').doc('notifications').set({ enabled: data.enabled }, { merge: true });
    functions.logger.log(`Owner ${context.auth.uid} set global notifications to: ${data.enabled}`);
    return { success: true };
});

// Firestore trigger that sends a push notification when a shift is created, updated, or deleted.
export const sendShiftNotification = functions.region("europe-west2").firestore.document("shifts/{shiftId}")
  .onWrite(async (change, context) => {
    const shiftId = context.params.shiftId;
    
    // Check master toggle first
    const settingsDoc = await db.collection('settings').doc('notifications').get();
    if (settingsDoc.exists() && settingsDoc.data()?.enabled === false) {
      functions.logger.log('Global notifications are disabled. Aborting.');
      return;
    }

    // Configure web-push with VAPID keys from function config
    const config = functions.config();
    const publicKey = config.webpush?.public_key;
    const privateKey = config.webpush?.private_key;
    if (!publicKey || !privateKey) {
      functions.logger.error("CRITICAL: VAPID keys are not configured.");
      return;
    }
    webPush.setVapidDetails("mailto:example@your-project.com", publicKey, privateKey);

    const beforeData = change.before.data();
    const afterData = change.after.data();
    
    let userId: string | null = null;
    let payload: object | null = null;

    // Case 1: New shift created
    if (afterData && !beforeData) {
        userId = afterData.userId;
        payload = {
            title: "New Shift Assigned",
            body: `You have a new shift: ${afterData.task} at ${afterData.address}.`,
            data: { url: `/dashboard` },
        };
    } 
    // Case 2: Shift deleted
    else if (!afterData && beforeData) {
        userId = beforeData.userId;
        payload = {
            title: "Shift Cancelled",
            body: `Your shift for ${beforeData.task} at ${beforeData.address} has been cancelled.`,
            data: { url: `/dashboard` },
        };
    } 
    // Case 3: Shift updated
    else if (beforeData && afterData) {
        const changedFields: string[] = [];
        if ((beforeData.task || "").trim() !== (afterData.task || "").trim()) changedFields.push('task');
        if ((beforeData.address || "").trim() !== (afterData.address || "").trim()) changedFields.push('location');
        if ((beforeData.bNumber || "").trim() !== (afterData.bNumber || "").trim()) changedFields.push('B Number');
        if (beforeData.type !== afterData.type) changedFields.push('time');
        if (beforeData.date && afterData.date && !beforeData.date.isEqual(afterData.date)) changedFields.push('date');

        if (changedFields.length > 0) {
            userId = afterData.userId;
            const changes = changedFields.join(' & ');
            payload = {
                title: "Your Shift Has Been Updated",
                body: `The ${changes} for one of your shifts has been updated.`,
                data: { url: `/dashboard` },
            };
        } else {
            functions.logger.log(`Shift ${shiftId} updated, but no significant fields changed. No notification sent.`);
            return;
        }
    } else {
        return; // No relevant change
    }

    if (!userId || !payload) return;

    const subscriptionsSnapshot = await db
        .collection("users").doc(userId).collection("pushSubscriptions")
        .withConverter(pushSubscriptionConverter).get();

    if (subscriptionsSnapshot.empty) {
        functions.logger.warn(`User ${userId} has no push subscriptions.`);
        return;
    }
    
    const sendPromises = subscriptionsSnapshot.docs.map(subDoc => {
        const subscription = subDoc.data();
        return webPush.sendNotification(subscription, JSON.stringify(payload)).catch((error: any) => {
            if (error.statusCode === 410 || error.statusCode === 404) {
                return subDoc.ref.delete(); // Prune expired subscription
            }
            functions.logger.error(`Error sending notification to user ${userId}:`, error);
            return null;
        });
    });

    await Promise.all(sendPromises);
    functions.logger.log(`Finished sending notifications for shift ${shiftId}.`);
});

// Scheduled function to remind project creators to review old projects.
export const projectReviewNotifier = functions.region("europe-west2").pubsub.schedule("every 24 hours")
  .onRun(async (context) => {
    // Similar checks for notification settings and VAPID keys as above...
    // [Implementation logic to query old projects and notify creators]
});

// Scheduled function to remind users of shifts pending their confirmation.
export const pendingShiftNotifier = functions.region("europe-west2").pubsub.schedule("every 1 hours")
  .onRun(async (context) => {
    // Similar checks for notification settings and VAPID keys as above...
    // [Implementation logic to query pending shifts and notify users]
});

// Admin callable functions for user and project management.

export const deleteProjectAndFiles = functions.region("europe-west2").https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Authentication required.");
    const userDoc = await db.collection("users").doc(context.auth.uid).get();
    if (!['admin', 'owner'].includes(userDoc.data()?.role)) throw new functions.https.HttpsError("permission-denied", "Admin access required.");
    
    const projectId = data.projectId;
    if (!projectId) throw new functions.https.HttpsError("invalid-argument", "Project ID is required.");
    
    const bucket = admin.storage().bucket();
    await bucket.deleteFiles({ prefix: `project_files/${projectId}/` });
    
    const projectRef = db.collection('projects').doc(projectId);
    const filesSnapshot = await projectRef.collection('files').get();
    const batch = db.batch();
    filesSnapshot.forEach(doc => batch.delete(doc.ref));
    batch.delete(projectRef);
    
    await batch.commit();
    return { success: true };
});

export const deleteProjectFile = functions.region("europe-west2").https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Authentication required.");
    
    const { projectId, fileId } = data;
    if (!projectId || !fileId) throw new functions.https.HttpsError("invalid-argument", "Project ID and File ID are required.");

    const fileRef = db.collection('projects').doc(projectId).collection('files').doc(fileId);
    const fileDoc = await fileRef.get();
    if (!fileDoc.exists) throw new functions.https.HttpsError("not-found", "File not found.");

    const fileData = fileDoc.data();
    if (!fileData) {
        throw new functions.https.HttpsError("not-found", "File data is missing.");
    }

    const userDoc = await db.collection("users").doc(context.auth.uid).get();
    const userRole = userDoc.data()?.role;

    if (context.auth.uid !== fileData.uploaderId && !['admin', 'owner'].includes(userRole)) {
        throw new functions.https.HttpsError("permission-denied", "You are not authorized to delete this file.");
    }
    
    await admin.storage().bucket().file(fileData.fullPath).delete();
    await fileRef.delete();
    
    return { success: true };
});

export const deleteAllShifts = functions.region("europe-west2").https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Authentication required.");
    const userDoc = await db.collection("users").doc(context.auth.uid).get();
    if (userDoc.data()?.role !== 'owner') throw new functions.https.HttpsError("permission-denied", "Owner access required.");

    const activeStatuses = ['pending-confirmation', 'confirmed', 'on-site', 'rejected'];
    const snapshot = await db.collection('shifts').where('status', 'in', activeStatuses).get();
    
    if (snapshot.empty) return { success: true, message: "No active shifts to delete." };

    const batch = db.batch();
    snapshot.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    
    return { success: true, message: `Deleted ${snapshot.size} active shifts.` };
});

export const deleteAllProjects = functions.region("europe-west2").https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Authentication required.");
    const userDoc = await db.collection("users").doc(context.auth.uid).get();
    if (userDoc.data()?.role !== 'owner') throw new functions.https.HttpsError("permission-denied", "Owner access required.");
    
    const bucket = admin.storage().bucket();
    const projectsSnapshot = await db.collection('projects').get();
    if (projectsSnapshot.empty) return { success: true, message: "No projects to delete." };

    for (const projectDoc of projectsSnapshot.docs) {
        await bucket.deleteFiles({ prefix: `project_files/${projectDoc.id}/` });
        const filesSnapshot = await projectDoc.ref.collection('files').get();
        const batch = db.batch();
        filesSnapshot.forEach(doc => batch.delete(doc.ref));
        batch.delete(projectDoc.ref);
        await batch.commit();
    }
    
    return { success: true, message: `Deleted ${projectsSnapshot.size} projects.` };
});

export const setUserStatus = functions.region("europe-west2").https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Authentication required.");
    const userDoc = await db.collection("users").doc(context.auth.uid).get();
    if (userDoc.data()?.role !== 'owner') throw new functions.https.HttpsError("permission-denied", "Owner access required.");
    
    const { uid, disabled, newStatus } = data;
    if (!uid || typeof disabled !== 'boolean' || !['active', 'suspended', 'pending-approval'].includes(newStatus)) {
        throw new functions.https.HttpsError("invalid-argument", "Invalid arguments provided.");
    }
    if (uid === context.auth.uid) throw new functions.https.HttpsError("permission-denied", "Owner cannot suspend own account.");
    
    await admin.auth().updateUser(uid, { disabled });
    await db.collection('users').doc(uid).update({ status: newStatus });
    
    return { success: true };
});

export const deleteUser = functions.region("europe-west2").https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "You must be logged in.");
  }
  const callerDoc = await db.collection("users").doc(context.auth.uid).get();
  if (callerDoc.data()?.role !== 'owner') {
    throw new functions.https.HttpsError("permission-denied", "Only the account owner can delete users.");
  }

  const { uid } = data;
  if (!uid) {
    throw new functions.https.HttpsError("invalid-argument", "UID is required.");
  }
  if (uid === context.auth.uid) {
    throw new functions.https.HttpsError("permission-denied", "The account owner cannot delete their own account.");
  }

  try {
    const subscriptionsRef = db.collection("users").doc(uid).collection("pushSubscriptions");
    const subscriptionsSnapshot = await subscriptionsRef.get();
    const batch = db.batch();
    subscriptionsSnapshot.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit(); 
    
    await db.collection("users").doc(uid).delete();
    await admin.auth().deleteUser(uid);
    
    return { success: true };
  } catch (error: any) {
    if (error.code === "auth/user-not-found") {
      functions.logger.warn(`User ${uid} was already deleted from Firebase Auth. Cleanup finished.`);
      return { success: true, message: "User already deleted from Auth." };
    }
    throw new functions.https.HttpsError("internal", `An unexpected error occurred: ${error.message}`);
  }
});
