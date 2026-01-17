"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteUser = exports.setUserStatus = exports.deleteAllProjects = exports.deleteAllShifts = exports.deleteProjectFile = exports.deleteProjectAndFiles = exports.pendingShiftNotifier = exports.projectReviewNotifier = exports.sendShiftNotification = exports.setNotificationStatus = exports.getNotificationStatus = exports.getVapidPublicKey = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-functions/v2/firestore");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const webPush = __importStar(require("web-push"));
const v2_1 = require("firebase-functions/v2");
const params_1 = require("firebase-functions/params");
// Initialize admin SDK only once
if (!firebase_admin_1.default.apps.length) {
    firebase_admin_1.default.initializeApp();
}
const db = firebase_admin_1.default.firestore();
// Define params for environment variables
const webpushPublicKey = (0, params_1.defineString)("WEBPUSH_PUBLIC_KEY");
const webpushPrivateKey = (0, params_1.defineString)("WEBPUSH_PRIVATE_KEY");
// Define a converter for the PushSubscription type for robust data handling.
const pushSubscriptionConverter = {
    toFirestore(subscription) {
        return { endpoint: subscription.endpoint, keys: subscription.keys };
    },
    fromFirestore(snapshot) {
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
exports.getVapidPublicKey = (0, https_1.onCall)({ region: europeWest2 }, (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "You must be logged in.");
    }
    const publicKey = webpushPublicKey.value();
    if (!publicKey) {
        v2_1.logger.error("CRITICAL: WEBPUSH_PUBLIC_KEY not set in function configuration.");
        throw new https_1.HttpsError('not-found', 'VAPID public key is not configured on the server.');
    }
    return { publicKey };
});
// Callable function for the owner to check the global notification status.
exports.getNotificationStatus = (0, https_1.onCall)({ region: europeWest2 }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "You must be logged in.");
    }
    const userDoc = await db.collection("users").doc(request.auth.uid).get();
    if (userDoc.data()?.role !== 'owner') {
        throw new https_1.HttpsError("permission-denied", "Only the account owner can view settings.");
    }
    const settingsDoc = await db.collection('settings').doc('notifications').get();
    return { enabled: settingsDoc.exists && (settingsDoc.data()?.enabled !== false) };
});
// Callable function for the owner to enable/disable all notifications globally.
exports.setNotificationStatus = (0, https_1.onCall)({ region: europeWest2 }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "You must be logged in.");
    }
    const userDoc = await db.collection("users").doc(request.auth.uid).get();
    if (userDoc.data()?.role !== 'owner') {
        throw new https_1.HttpsError("permission-denied", "Only the account owner can change settings.");
    }
    if (typeof request.data.enabled !== 'boolean') {
        throw new https_1.HttpsError("invalid-argument", "The 'enabled' field must be a boolean.");
    }
    await db.collection('settings').doc('notifications').set({ enabled: request.data.enabled }, { merge: true });
    v2_1.logger.log(`Owner ${request.auth.uid} set global notifications to: ${request.data.enabled}`);
    return { success: true };
});
// Firestore trigger that sends a push notification when a shift is created, updated, or deleted.
exports.sendShiftNotification = (0, firestore_1.onDocumentWritten)({ document: "shifts/{shiftId}", region: europeWest2 }, async (event) => {
    const settingsDoc = await db.collection('settings').doc('notifications').get();
    if (settingsDoc.exists && settingsDoc.data()?.enabled === false) {
        v2_1.logger.log('Global notifications are disabled. Aborting.');
        return;
    }
    const publicKey = webpushPublicKey.value();
    const privateKey = webpushPrivateKey.value();
    if (!publicKey || !privateKey) {
        v2_1.logger.error("CRITICAL: VAPID keys are not configured.");
        return;
    }
    webPush.setVapidDetails("mailto:example@your-project.com", publicKey, privateKey);
    const beforeData = event.data?.before.data();
    const afterData = event.data?.after.data();
    let userId = null;
    let payload = null;
    if (event.data?.after.exists && !event.data?.before.exists && afterData) {
        userId = afterData.userId;
        payload = {
            title: "New Shift Assigned",
            body: `You have a new shift: ${afterData.task} at ${afterData.address}.`,
            data: { url: `/dashboard` },
        };
    }
    else if (event.data?.before.exists && !event.data?.after.exists && beforeData) {
        userId = beforeData.userId;
        payload = {
            title: "Shift Cancelled",
            body: `Your shift for ${beforeData.task} at ${beforeData.address} has been cancelled.`,
            data: { url: `/dashboard` },
        };
    }
    else if (event.data?.before.exists && event.data?.after.exists && beforeData && afterData) {
        const changedFields = [];
        if ((beforeData.task || "").trim() !== (afterData.task || "").trim())
            changedFields.push('task');
        if ((beforeData.address || "").trim() !== (afterData.address || "").trim())
            changedFields.push('location');
        if ((beforeData.eNumber || "").trim() !== (afterData.eNumber || "").trim())
            changedFields.push('E Number');
        if (beforeData.type !== afterData.type)
            changedFields.push('time (AM/PM)');
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
        }
        else {
            return;
        }
    }
    else {
        return;
    }
    if (!userId || !payload)
        return;
    const subscriptionsSnapshot = await db
        .collection("users").doc(userId).collection("pushSubscriptions")
        .withConverter(pushSubscriptionConverter).get();
    if (subscriptionsSnapshot.empty)
        return;
    const sendPromises = subscriptionsSnapshot.docs.map(subDoc => {
        const subscription = subDoc.data();
        return webPush.sendNotification(subscription, JSON.stringify(payload)).catch((error) => {
            if (error.statusCode === 410 || error.statusCode === 404)
                return subDoc.ref.delete();
            v2_1.logger.error(`Error sending notification to user ${userId}:`, error);
            return null;
        });
    });
    await Promise.all(sendPromises);
});
exports.projectReviewNotifier = (0, scheduler_1.onSchedule)({ schedule: "every 24 hours", region: europeWest2 }, async (event) => {
    v2_1.logger.log("Running daily project review notifier.");
    const settingsDoc = await db.collection('settings').doc('notifications').get();
    if (settingsDoc.exists && (settingsDoc.data()?.enabled === false)) {
        v2_1.logger.log('Global notifications are disabled by the owner. Aborting project review notifier.');
        return;
    }
    const publicKey = webpushPublicKey.value();
    const privateKey = webpushPrivateKey.value();
    if (!publicKey || !privateKey) {
        v2_1.logger.error("CRITICAL: VAPID keys are not configured. Cannot send project review notifications.");
        return;
    }
    webPush.setVapidDetails("mailto:example@your-project.com", publicKey, privateKey);
    const now = firebase_admin_1.default.firestore.Timestamp.now();
    const projectsToReviewQuery = db.collection("projects").where("nextReviewDate", "<=", now);
    try {
        const querySnapshot = await projectsToReviewQuery.get();
        if (querySnapshot.empty) {
            v2_1.logger.log("No projects due for review today.");
            return;
        }
        v2_1.logger.log(`Found ${querySnapshot.size} projects to review.`);
        const batch = db.batch();
        for (const projectDoc of querySnapshot.docs) {
            const projectData = projectDoc.data();
            const { creatorId, address } = projectData;
            if (!creatorId) {
                v2_1.logger.warn(`Project ${projectDoc.id} (${address}) is due for review but has no creatorId. Skipping.`);
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
                v2_1.logger.warn(`Creator ${creatorId} for project ${address} has no push subscriptions.`);
            }
            else {
                v2_1.logger.log(`Sending review notification for project ${address} to creator ${creatorId}.`);
                const sendPromises = subscriptionsSnapshot.docs.map((subDoc) => {
                    const subscription = subDoc.data();
                    return webPush.sendNotification(subscription, payload).catch((error) => {
                        v2_1.logger.error(`Error sending notification to user ${creatorId}:`, error);
                        if (error.statusCode === 410 || error.statusCode === 404) {
                            v2_1.logger.log(`Deleting invalid subscription for user ${creatorId}.`);
                            return subDoc.ref.delete();
                        }
                        return null;
                    });
                });
                await Promise.all(sendPromises);
            }
            const newReviewDate = new Date();
            newReviewDate.setDate(newReviewDate.getDate() + 28);
            batch.update(projectDoc.ref, { nextReviewDate: firebase_admin_1.default.firestore.Timestamp.fromDate(newReviewDate) });
        }
        await batch.commit();
        v2_1.logger.log("Finished processing project reviews and updated next review dates.");
    }
    catch (error) {
        v2_1.logger.error("Error running project review notifier:", error);
    }
});
exports.pendingShiftNotifier = (0, scheduler_1.onSchedule)({ schedule: "every 1 hours", region: europeWest2 }, async (event) => {
    v2_1.logger.log("Running hourly pending shift notifier.");
    const settingsDoc = await db.collection('settings').doc('notifications').get();
    if (settingsDoc.exists && (settingsDoc.data()?.enabled === false)) {
        v2_1.logger.log('Global notifications are disabled by the owner. Aborting pending shift notifier.');
        return;
    }
    const publicKey = webpushPublicKey.value();
    const privateKey = webpushPrivateKey.value();
    if (!publicKey || !privateKey) {
        v2_1.logger.error("CRITICAL: VAPID keys are not configured. Cannot send pending shift reminders.");
        return;
    }
    webPush.setVapidDetails("mailto:example@your-project.com", publicKey, privateKey);
    try {
        const pendingShiftsQuery = db.collection("shifts").where("status", "==", "pending-confirmation");
        const querySnapshot = await pendingShiftsQuery.get();
        if (querySnapshot.empty) {
            v2_1.logger.log("No pending shifts found.");
            return;
        }
        const shiftsByUser = new Map();
        querySnapshot.forEach(doc => {
            const shift = doc.data();
            if (shift.userId) {
                if (!shiftsByUser.has(shift.userId)) {
                    shiftsByUser.set(shift.userId, []);
                }
                shiftsByUser.get(shift.userId).push(shift);
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
                v2_1.logger.warn(`User ${userId} has ${userShifts.length} pending shift(s) but no push subscriptions.`);
                continue;
            }
            const notificationPayload = JSON.stringify({
                title: "Pending Shifts Reminder",
                body: `You have ${userShifts.length} shift(s) awaiting your confirmation. Please review them in the app.`,
                data: { url: "/dashboard" },
            });
            v2_1.logger.log(`Sending reminder to user ${userId} for ${userShifts.length} pending shift(s).`);
            const sendPromises = subscriptionsSnapshot.docs.map(subDoc => {
                const subscription = subDoc.data();
                return webPush.sendNotification(subscription, notificationPayload).catch((error) => {
                    v2_1.logger.error(`Error sending notification to user ${userId}:`, error);
                    if (error.statusCode === 410 || error.statusCode === 404) {
                        v2_1.logger.log(`Deleting invalid subscription for user ${userId}.`);
                        return subDoc.ref.delete();
                    }
                    return null;
                });
            });
            await Promise.all(sendPromises);
        }
        v2_1.logger.log("Finished processing pending shift reminders.");
    }
    catch (error) {
        v2_1.logger.error("Error running pendingShiftNotifier:", error);
    }
});
exports.deleteProjectAndFiles = (0, https_1.onCall)({ region: europeWest2 }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Authentication required.");
    const userDoc = await db.collection("users").doc(request.auth.uid).get();
    if (!['admin', 'owner', 'manager'].includes(userDoc.data()?.role)) {
        throw new https_1.HttpsError("permission-denied", "You do not have permission to perform this action.");
    }
    const projectId = request.data.projectId;
    if (!projectId)
        throw new https_1.HttpsError("invalid-argument", "Project ID is required.");
    const bucket = firebase_admin_1.default.storage().bucket();
    await bucket.deleteFiles({ prefix: `project_files/${projectId}/` });
    const projectRef = db.collection('projects').doc(projectId);
    const filesSnapshot = await projectRef.collection('files').get();
    const batch = db.batch();
    filesSnapshot.forEach(doc => batch.delete(doc.ref));
    batch.delete(projectRef);
    await batch.commit();
    return { success: true, message: `Project ${projectId} and all associated files deleted successfully.` };
});
exports.deleteProjectFile = (0, https_1.onCall)({ region: europeWest2 }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Authentication required.");
    const { projectId, fileId } = request.data;
    if (!projectId || !fileId)
        throw new https_1.HttpsError("invalid-argument", "Project ID and File ID are required.");
    const fileRef = db.collection('projects').doc(projectId).collection('files').doc(fileId);
    const fileDoc = await fileRef.get();
    if (!fileDoc.exists)
        throw new https_1.HttpsError("not-found", "File not found.");
    const fileData = fileDoc.data();
    if (!fileData.fullPath || !fileData.uploaderId) {
        await fileRef.delete();
        throw new https_1.HttpsError("internal", "The file's database record was corrupt and has been removed.");
    }
    const userDoc = await db.collection("users").doc(request.auth.uid).get();
    const isPrivileged = ['admin', 'owner', 'manager'].includes(userDoc.data()?.role);
    const isUploader = request.auth.uid === fileData.uploaderId;
    if (!isPrivileged && !isUploader) {
        throw new https_1.HttpsError("permission-denied", "You do not have permission to delete this file.");
    }
    await firebase_admin_1.default.storage().bucket().file(fileData.fullPath).delete();
    await fileRef.delete();
    return { success: true, message: `File ${fileId} deleted successfully.` };
});
exports.deleteAllShifts = (0, https_1.onCall)({ region: europeWest2 }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Authentication required.");
    const userDoc = await db.collection("users").doc(request.auth.uid).get();
    if (userDoc.data()?.role !== 'owner')
        throw new https_1.HttpsError("permission-denied", "Owner access required.");
    const activeStatuses = ['pending-confirmation', 'confirmed', 'on-site', 'rejected'];
    const snapshot = await db.collection('shifts').where('status', 'in', activeStatuses).get();
    if (snapshot.empty)
        return { success: true, message: "No active shifts to delete." };
    const batch = db.batch();
    snapshot.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    return { success: true, message: `Successfully deleted ${snapshot.size} active shifts.` };
});
exports.deleteAllProjects = (0, https_1.onCall)({ region: europeWest2 }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Authentication required.");
    const userDoc = await db.collection("users").doc(request.auth.uid).get();
    if (userDoc.data()?.role !== 'owner')
        throw new https_1.HttpsError("permission-denied", "Owner access required.");
    const projectsSnapshot = await db.collection('projects').get();
    if (projectsSnapshot.empty)
        return { success: true, message: "No projects to delete." };
    const bucket = firebase_admin_1.default.storage().bucket();
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
exports.setUserStatus = (0, https_1.onCall)({ region: europeWest2 }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Authentication required.");
    const callerDoc = await db.collection("users").doc(request.auth.uid).get();
    if (callerDoc.data()?.role !== 'owner')
        throw new https_1.HttpsError("permission-denied", "Owner access required.");
    const { uid, disabled, newStatus } = request.data;
    const validStatuses = ['active', 'suspended', 'pending-approval'];
    if (typeof uid !== 'string' || typeof disabled !== 'boolean' || !validStatuses.includes(newStatus)) {
        throw new https_1.HttpsError("invalid-argument", "Invalid arguments provided.");
    }
    if (uid === request.auth.uid)
        throw new https_1.HttpsError("permission-denied", "Owner cannot change their own status.");
    await firebase_admin_1.default.auth().updateUser(uid, { disabled });
    await db.collection('users').doc(uid).update({ status: newStatus });
    return { success: true };
});
exports.deleteUser = (0, https_1.onCall)({ region: europeWest2 }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Authentication required.");
    const callerDoc = await db.collection("users").doc(request.auth.uid).get();
    if (callerDoc.data()?.role !== 'owner')
        throw new https_1.HttpsError("permission-denied", "Only the account owner can delete users.");
    const { uid } = request.data;
    if (typeof uid !== "string")
        throw new https_1.HttpsError("invalid-argument", "UID is required.");
    if (uid === request.auth.uid)
        throw new https_1.HttpsError("permission-denied", "Owner cannot delete their own account.");
    try {
        const subscriptionsRef = db.collection("users").doc(uid).collection("pushSubscriptions");
        const subscriptionsSnapshot = await subscriptionsRef.get();
        if (!subscriptionsSnapshot.empty) {
            const batch = db.batch();
            subscriptionsSnapshot.docs.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
        }
        await db.collection("users").doc(uid).delete();
        await firebase_admin_1.default.auth().deleteUser(uid);
        return { success: true };
    }
    catch (error) {
        if (error.code === "auth/user-not-found") {
            return { success: true, message: "User was already deleted from Authentication." };
        }
        throw new https_1.HttpsError("internal", `An unexpected error occurred: ${error.message}`);
    }
});
