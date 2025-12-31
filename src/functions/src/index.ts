
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import admin from "firebase-admin";
import * as webPush from "web-push";
import { logger } from "firebase-functions/v2";
import { defineString } from "firebase-functions/params";
import JSZip from "jszip";

// Initialize admin SDK only once
if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

// Define params for environment variables
const webpushPublicKey = defineString("WEBPUSH_PUBLIC_KEY");
const webpushPrivateKey = defineString("WEBPUSH_PRIVATE_KEY");

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

// Callable function to securely provide the VAPID public key to the client.
export const getVapidPublicKey = onCall({ region: europeWest2 }, (request) => {
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

// Callable function for the owner to check the global notification status.
export const getNotificationStatus = onCall({ region: europeWest2 }, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "You must be logged in.");
    }
    const userDoc = await db.collection("users").doc(request.auth.uid).get();
    if (userDoc.data()?.role !== 'owner') {
        throw new HttpsError("permission-denied", "Only the account owner can view settings.");
    }
    const settingsDoc = await db.collection('settings').doc('notifications').get();
    return { enabled: settingsDoc.exists && Boolean(settingsDoc.data()?.enabled) !== false };
});

// Callable function for the owner to enable/disable all notifications globally.
export const setNotificationStatus = onCall({ region: europeWest2 }, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "You must be logged in.");
    }
    const userDoc = await db.collection("users").doc(request.auth.uid).get();
    if (userDoc.data()?.role !== 'owner') {
        throw new HttpsError("permission-denied", "Only the account owner can change settings.");
    }
    if (typeof request.data.enabled !== 'boolean') {
        throw new HttpsError("invalid-argument", "The 'enabled' field must be a boolean.");
    }
    await db.collection('settings').doc('notifications').set({ enabled: request.data.enabled }, { merge: true });
    logger.log(`Owner ${request.auth.uid} set global notifications to: ${request.data.enabled}`);
    return { success: true };
});

// Firestore trigger that sends a push notification when a shift is created, updated, or deleted.
export const sendShiftNotification = onDocumentWritten({ document: "shifts/{shiftId}", region: europeWest2 }, async (event) => {
    const settingsDoc = await db.collection('settings').doc('notifications').get();
    if (settingsDoc.exists() && Boolean(settingsDoc.data()?.enabled) === false) {
        logger.log('Global notifications are disabled. Aborting.');
        return;
    }
    
    const publicKey = webpushPublicKey.value();
    const privateKey = webpushPrivateKey.value();

    if (!publicKey || !privateKey) {
        logger.error("CRITICAL: VAPID keys are not configured.");
        return;
    }
    webPush.setVapidDetails("mailto:example@your-project.com", publicKey, privateKey);

    const beforeData = event.data?.before.data();
    const afterData = event.data?.after.data();

    let userId: string | null = null;
    let payload: object | null = null;

    if (event.data?.after.exists && !event.data?.before.exists && afterData) {
        userId = afterData.userId;
        payload = {
            title: "New Shift Assigned",
            body: `You have a new shift: ${afterData.task} at ${afterData.address}.`,
            data: { url: `/dashboard` },
        };
    } else if (event.data?.before.exists && !event.data?.after.exists && beforeData) {
        userId = beforeData.userId;
        payload = {
            title: "Shift Cancelled",
            body: `Your shift for ${beforeData.task} at ${beforeData.address} has been cancelled.`,
            data: { url: `/dashboard` },
        };
    } else if (event.data?.before.exists && event.data?.after.exists && beforeData && afterData) {
        const changedFields: string[] = [];
        if ((beforeData.task || "").trim() !== (afterData.task || "").trim()) changedFields.push('task');
        if ((beforeData.address || "").trim() !== (afterData.address || "").trim()) changedFields.push('location');
        if ((beforeData.eNumber || "").trim() !== (afterData.eNumber || "").trim()) changedFields.push('E Number');
        if (beforeData.type !== afterData.type) changedFields.push('time (AM/PM)');
        
        if (beforeData.date && afterData.date && !beforeData.date.isEqual(afterData.date)) {
            changedFields.push('date');
        }

        if (changedFields.length > 0) {
            userId = afterData.userId;
            const changes = changedFields.join(' & ');
            payload = {
                title: "Your Shift Has Been Updated",
                body: `The ${changes} for one of your shifts has been updated.`,
                data: { url: `/dashboard` },
            };
        } else {
            return;
        }
    } else {
        return;
    }

    if (!userId || !payload) return;

    const subscriptionsSnapshot = await db
        .collection("users").doc(userId).collection("pushSubscriptions")
        .withConverter(pushSubscriptionConverter).get();
    
    if (subscriptionsSnapshot.empty) return;

    const sendPromises = subscriptionsSnapshot.docs.map(subDoc => {
        const subscription = subDoc.data();
        return webPush.sendNotification(subscription, JSON.stringify(payload)).catch((error: any) => {
            if (error.statusCode === 410 || error.statusCode === 404) return subDoc.ref.delete();
            logger.error(`Error sending notification to user ${userId}:`, error);
            return null;
        });
    });
    await Promise.all(sendPromises);
});


export const projectReviewNotifier = onSchedule({ schedule: "every 24 hours", region: europeWest2 }, async (event) => {
    logger.log("Running daily project review notifier.");
    const settingsDoc = await db.collection('settings').doc('notifications').get();
    if (settingsDoc.exists() && Boolean(settingsDoc.data()?.enabled) === false) {
      logger.log('Global notifications are disabled by the owner. Aborting project review notifier.');
      return;
    }
    const publicKey = webpushPublicKey.value();
    const privateKey = webpushPrivateKey.value();
    if (!publicKey || !privateKey) {
      logger.error("CRITICAL: VAPID keys are not configured. Cannot send project review notifications.");
      return;
    }
    webPush.setVapidDetails("mailto:example@your-project.com", publicKey, privateKey);
    const now = admin.firestore.Timestamp.now();
    const projectsToReviewQuery = db.collection("projects").where("nextReviewDate", "<=", now);
    try {
        const querySnapshot = await projectsToReviewQuery.get();
        if (querySnapshot.empty) {
            logger.log("No projects due for review today.");
            return;
        }
        logger.log(`Found ${querySnapshot.size} projects to review.`);
        const batch = db.batch();
        for (const projectDoc of querySnapshot.docs) {
            const projectData = projectDoc.data();
            const { creatorId, address } = projectData;
            if (!creatorId) {
                logger.warn(`Project ${projectDoc.id} (${address}) is due for review but has no creatorId. Skipping.`);
                continue;
            }
            const payload = JSON.stringify({
                title: "Project Review Reminder",
                body: `It's time to review the project at ${address}. Please check if it can be archived.`,
                data: { url: "/projects" },
            });
            const subscriptionsSnapshot = await db
                .collection("users")
                .doc(creatorId)
                .collection("pushSubscriptions")
                .withConverter(pushSubscriptionConverter)
                .get();
            if (subscriptionsSnapshot.empty) {
                logger.warn(`Creator ${creatorId} for project ${address} has no push subscriptions.`);
            } else {
                logger.log(`Sending review notification for project ${address} to creator ${creatorId}.`);
                const sendPromises = subscriptionsSnapshot.docs.map((subDoc) => {
                    const subscription = subDoc.data();
                    return webPush.sendNotification(subscription, payload).catch((error: any) => {
                        logger.error(`Error sending notification to user ${creatorId}:`, error);
                        if (error.statusCode === 410 || error.statusCode === 404) {
                            logger.log(`Deleting invalid subscription for user ${creatorId}.`);
                            return subDoc.ref.delete();
                        }
                        return null;
                    });
                });
                await Promise.all(sendPromises);
            }
            const newReviewDate = new Date();
            newReviewDate.setDate(newReviewDate.getDate() + 28);
            batch.update(projectDoc.ref, { nextReviewDate: admin.firestore.Timestamp.fromDate(newReviewDate) });
        }
        await batch.commit();
        logger.log("Finished processing project reviews and updated next review dates.");
    } catch (error) {
        logger.error("Error running project review notifier:", error);
    }
});

export const pendingShiftNotifier = onSchedule({ schedule: "every 1 hours", region: europeWest2 }, async (event) => {
    logger.log("Running hourly pending shift notifier.");
    const settingsDoc = await db.collection('settings').doc('notifications').get();
    if (settingsDoc.exists() && Boolean(settingsDoc.data()?.enabled) === false) {
      logger.log('Global notifications are disabled by the owner. Aborting pending shift notifier.');
      return;
    }
    const publicKey = webpushPublicKey.value();
    const privateKey = webpushPrivateKey.value();
    if (!publicKey || !privateKey) {
      logger.error("CRITICAL: VAPID keys are not configured. Cannot send pending shift reminders.");
      return;
    }
    webPush.setVapidDetails("mailto:example@your-project.com", publicKey, privateKey);
    try {
      const pendingShiftsQuery = db.collection("shifts").where("status", "==", "pending-confirmation");
      const querySnapshot = await pendingShiftsQuery.get();
      if (querySnapshot.empty) {
        logger.log("No pending shifts found.");
        return;
      }
      const shiftsByUser = new Map<string, any[]>();
      querySnapshot.forEach(doc => {
        const shift = doc.data();
        if (shift.userId) {
          if (!shiftsByUser.has(shift.userId)) {
            shiftsByUser.set(shift.userId, []);
          }
          shiftsByUser.get(shift.userId)!.push(shift);
        }
      });
      for (const [userId, userShifts] of shiftsByUser.entries()) {
        const subscriptionsSnapshot = await db
          .collection("users")
          .doc(userId)
          .collection("pushSubscriptions")
          .withConverter(pushSubscriptionConverter)
          .get();
        if (subscriptionsSnapshot.empty) {
          logger.warn(`User ${userId} has ${userShifts.length} pending shift(s) but no push subscriptions.`);
          continue;
        }
        const notificationPayload = JSON.stringify({
          title: "Pending Shifts Reminder",
          body: `You have ${userShifts.length} shift(s) awaiting your confirmation. Please review them in the app.`,
          data: { url: "/dashboard" },
        });
        logger.log(`Sending reminder to user ${userId} for ${userShifts.length} pending shift(s).`);
        const sendPromises = subscriptionsSnapshot.docs.map(subDoc => {
          const subscription = subDoc.data();
          return webPush.sendNotification(subscription, notificationPayload).catch((error: any) => {
            logger.error(`Error sending notification to user ${userId}:`, error);
            if (error.statusCode === 410 || error.statusCode === 404) {
              logger.log(`Deleting invalid subscription for user ${userId}.`);
              return subDoc.ref.delete();
            }
            return null;
          });
        });
        await Promise.all(sendPromises);
      }
      logger.log("Finished processing pending shift reminders.");
    } catch (error) {
      logger.error("Error running pendingShiftNotifier:", error);
    }
});


export const deleteProjectAndFiles = onCall({ region: europeWest2 }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
    const userDoc = await db.collection("users").doc(request.auth.uid).get();
    if (!['admin', 'owner', 'manager'].includes(userDoc.data()?.role)) {
        throw new HttpsError("permission-denied", "You do not have permission to perform this action.");
    }
    const projectId = request.data.projectId;
    if (!projectId) throw new HttpsError("invalid-argument", "Project ID is required.");
    
    const bucket = admin.storage().bucket();
    await bucket.deleteFiles({ prefix: `project_files/${projectId}/` });
    
    const projectRef = db.collection('projects').doc(projectId);
    const filesSnapshot = await projectRef.collection('files').get();
    const batch = db.batch();
    filesSnapshot.forEach(doc => batch.delete(doc.ref));
    batch.delete(projectRef);
    await batch.commit();

    return { success: true, message: `Project ${projectId} and all associated files deleted successfully.` };
});


export const deleteProjectFile = onCall({ region: europeWest2 }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
    const { projectId, fileId } = request.data;
    if (!projectId || !fileId) throw new HttpsError("invalid-argument", "Project ID and File ID are required.");
    
    const fileRef = db.collection('projects').doc(projectId).collection('files').doc(fileId);
    const fileDoc = await fileRef.get();
    if (!fileDoc.exists) throw new HttpsError("not-found", "File not found.");

    const fileData = fileDoc.data()!;
    if (!fileData.fullPath || !fileData.uploaderId) {
         await fileRef.delete();
         throw new HttpsError("internal", "The file's database record was corrupt and has been removed.");
    }
    
    const userDoc = await db.collection("users").doc(request.auth.uid).get();
    const isPrivileged = ['admin', 'owner', 'manager'].includes(userDoc.data()?.role);
    const isUploader = request.auth.uid === fileData.uploaderId;

    if (!isPrivileged && !isUploader) {
        throw new HttpsError("permission-denied", "You do not have permission to delete this file.");
    }

    await admin.storage().bucket().file(fileData.fullPath).delete();
    await fileRef.delete();

    return { success: true, message: `File ${fileId} deleted successfully.` };
});

export const deleteAllShifts = onCall({ region: europeWest2 }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
    const userDoc = await db.collection("users").doc(request.auth.uid).get();
    if (userDoc.data()?.role !== 'owner') throw new HttpsError("permission-denied", "Owner access required.");

    const activeStatuses = ['pending-confirmation', 'confirmed', 'on-site', 'rejected'];
    const snapshot = await db.collection('shifts').where('status', 'in', activeStatuses).get();
    if (snapshot.empty) return { success: true, message: "No active shifts to delete." };

    const batch = db.batch();
    snapshot.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();

    return { success: true, message: `Successfully deleted ${snapshot.size} active shifts.` };
});


export const deleteAllProjects = onCall({ region: europeWest2 }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
    const userDoc = await db.collection("users").doc(request.auth.uid).get();
    if (userDoc.data()?.role !== 'owner') throw new HttpsError("permission-denied", "Owner access required.");
    
    const projectsSnapshot = await db.collection('projects').get();
    if (projectsSnapshot.empty) return { success: true, message: "No projects to delete." };

    const bucket = admin.storage().bucket();
    for (const projectDoc of projectsSnapshot.docs) {
        await bucket.deleteFiles({ prefix: `project_files/${projectDoc.id}/` });
        const filesSnapshot = await projectDoc.ref.collection('files').get();
        const batch = db.batch();
        filesSnapshot.forEach(doc => batch.delete(doc.ref));
        batch.delete(projectDoc.ref);
        await batch.commit();
    }
    
    return { success: true, message: `Successfully deleted ${projectsSnapshot.size} projects and all associated files.` };
});


export const setUserStatus = onCall({ region: europeWest2 }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
    const callerDoc = await db.collection("users").doc(request.auth.uid).get();
    if (callerDoc.data()?.role !== 'owner') throw new HttpsError("permission-denied", "Owner access required.");

    const { uid, disabled, newStatus } = request.data;
    const validStatuses = ['active', 'suspended', 'pending-approval'];
    if (typeof uid !== 'string' || typeof disabled !== 'boolean' || !validStatuses.includes(newStatus)) {
        throw new HttpsError("invalid-argument", "Invalid arguments provided.");
    }
    if (uid === request.auth.uid) throw new HttpsError("permission-denied", "Owner cannot change their own status.");

    await admin.auth().updateUser(uid, { disabled });
    await db.collection('users').doc(uid).update({ status: newStatus });

    return { success: true };
});


export const deleteUser = onCall({ region: europeWest2 }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
    const callerDoc = await db.collection("users").doc(request.auth.uid).get();
    if (callerDoc.data()?.role !== 'owner') throw new HttpsError("permission-denied", "Only the account owner can delete users.");

    const { uid } = request.data;
    if (typeof uid !== "string") throw new HttpsError("invalid-argument", "UID is required.");
    if (uid === request.auth.uid) throw new HttpsError("permission-denied", "Owner cannot delete their own account.");

    try {
        const subscriptionsRef = db.collection("users").doc(uid).collection("pushSubscriptions");
        const subscriptionsSnapshot = await subscriptionsRef.get();
        if (!subscriptionsSnapshot.empty) {
            const batch = db.batch();
            subscriptionsSnapshot.docs.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
        }
        await db.collection("users").doc(uid).delete();
        await admin.auth().deleteUser(uid);
        return { success: true };
    } catch (error: any) {
        if (error.code === "auth/user-not-found") {
            return { success: true, message: "User was already deleted from Authentication." };
        }
        throw new HttpsError("internal", `An unexpected error occurred: ${error.message}`);
    }
});


export const zipProjectFiles = onCall(
  { region: europeWest2, timeoutSeconds: 300, memory: "1GiB" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "You must be logged in.");
    }

    const projectId = request.data?.projectId;
    if (!projectId) {
      throw new HttpsError("invalid-argument", "projectId is required.");
    }

    const bucket = admin.storage().bucket();
    const zip = new JSZip();

    const filesSnap = await db
      .collection("projects")
      .doc(projectId)
      .collection("files")
      .get();

    if (filesSnap.empty) {
      throw new HttpsError("not-found", "No files to zip.");
    }

    let added = 0;

    for (const doc of filesSnap.docs) {
      const data = doc.data();
      if (!data.fullPath || !data.name) {
        logger.warn("Skipping file with missing data", { fileId: doc.id });
        continue;
      }
      try {
        const [buffer] = await bucket.file(data.fullPath).download();
        zip.file(data.name, buffer);
        added++;
      } catch (err) {
        logger.error("Download failed for file:", { fullPath: data.fullPath, error: err });
      }
    }

    if (added === 0) {
      throw new HttpsError("internal", "Files exist in Firestore but none could be downloaded from Storage. Check function logs for details.");
    }

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

    const zipPath = `temp_zips/project_${projectId}_${Date.now()}.zip`;
    const zipFile = bucket.file(zipPath);

    await zipFile.save(zipBuffer, {
      contentType: "application/zip",
      resumable: false,
    });

    const [url] = await zipFile.getSignedUrl({
      action: "read",
      expires: Date.now() + 15 * 60 * 1000,
      version: "v4",
    });

    return { downloadUrl: url };
  }
);
