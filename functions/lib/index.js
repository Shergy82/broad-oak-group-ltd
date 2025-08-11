
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
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteAllProjects = exports.deleteAllShifts = exports.deleteProjectFile = exports.deleteProjectAndFiles = exports.projectReviewNotifier = exports.sendShiftNotification = exports.setNotificationStatus = exports.getNotificationStatus = exports.getVapidPublicKey = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const webPush = __importStar(require("web-push"));
admin.initializeApp();
const db = admin.firestore();
// Define a converter for the PushSubscription type.
// This is the modern, correct way to handle typed data with Firestore.
// It ensures that when we fetch data, it's already in the correct shape.
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
            keys: {
                p256dh: data.keys.p256dh,
                auth: data.keys.auth
            }
        };
    }
};
// This is the v1 SDK syntax for onCall functions
exports.getVapidPublicKey = functions.region("europe-west2").https.onCall((data, context) => {
    var _a;
    const publicKey = (_a = functions.config().webpush) === null || _a === void 0 ? void 0 : _a.public_key;
    if (!publicKey) {
        functions.logger.error("CRITICAL: VAPID public key (webpush.public_key) not set in function configuration.");
        throw new functions.https.HttpsError('not-found', 'VAPID public key is not configured on the server.');
    }
    return { publicKey };
});
exports.getNotificationStatus = functions.region("europe-west2").https.onCall(async (data, context) => {
    // 1. Authentication check
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "You must be logged in to perform this action.");
    }
    // 2. Authorization check
    const uid = context.auth.uid;
    const userDoc = await db.collection("users").doc(uid).get();
    const userProfile = userDoc.data();
    if (!userProfile || userProfile.role !== 'owner') {
        throw new functions.https.HttpsError("permission-denied", "Only the account owner can view notification settings.");
    }
    // 3. Execution
    try {
        const settingsRef = db.collection('settings').doc('notifications');
        const docSnap = await settingsRef.get();
        if (docSnap.exists() && docSnap.data()?.enabled === false) {
            return { enabled: false };
        }
        return { enabled: true }; // Default to enabled
    }
    catch (error) {
        functions.logger.error("Error reading notification settings:", error);
        throw new functions.https.HttpsError("internal", "An unexpected error occurred while reading the settings.");
    }
});
exports.setNotificationStatus = functions.region("europe-west2").https.onCall(async (data, context) => {
    // 1. Authentication check
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "You must be logged in to perform this action.");
    }
    // 2. Authorization check
    const uid = context.auth.uid;
    const userDoc = await db.collection("users").doc(uid).get();
    const userProfile = userDoc.data();
    if (!userProfile || userProfile.role !== 'owner') {
        throw new functions.https.HttpsError("permission-denied", "Only the account owner can change notification settings.");
    }
    // 3. Validation
    const { enabled } = data;
    if (typeof enabled !== 'boolean') {
        throw new functions.https.HttpsError("invalid-argument", "The 'enabled' field must be a boolean value.");
    }
    // 4. Execution
    try {
        const settingsRef = db.collection('settings').doc('notifications');
        await settingsRef.set({ enabled: enabled }, { merge: true });
        functions.logger.log(`Owner ${uid} set global notifications to: ${enabled}`);
        return { success: true };
    }
    catch (error) {
        functions.logger.error("Error updating notification settings:", error);
        throw new functions.https.HttpsError("internal", "An unexpected error occurred while updating the settings.");
    }
});
exports.sendShiftNotification = functions.region("europe-west2").firestore.document("shifts/{shiftId}")
    .onWrite(async (change, context) => {
    var _a, _b, _c, _d, _e;
    const shiftId = context.params.shiftId;
    functions.logger.log(`Function triggered for shiftId: ${shiftId}`);
    // --- Master Notification Toggle Check ---
    const settingsRef = db.collection('settings').doc('notifications');
    const settingsDoc = await settingsRef.get();
    if (settingsDoc.exists() && settingsDoc.data()?.enabled === false) {
        functions.logger.log('Global notifications are disabled by the owner. Aborting.');
        return;
    }
    const config = functions.config();
    const publicKey = (_a = config.webpush) === null || _a === void 0 ? void 0 : _a.public_key;
    const privateKey = (_b = config.webpush) === null || _b === void 0 ? void 0 : _b.private_key;
    if (!publicKey || !privateKey) {
        functions.logger.error("CRITICAL: VAPID keys are not configured. Run the Firebase CLI command from the 'VAPID Key Generator' in the admin panel.");
        return;
    }
    webPush.setVapidDetails("mailto:example@your-project.com", publicKey, privateKey);
    const shiftDataBefore = change.before.data();
    const shiftDataAfter = change.after.data();
    let userId = null;
    let payload = null;
    if (change.after.exists() && !change.before.exists()) {
        // A new shift is created
        userId = shiftDataAfter === null || shiftDataAfter === void 0 ? void 0 : shiftDataAfter.userId;
        payload = {
            title: "New Shift Assigned",
            body: `You have a new shift: ${shiftDataAfter === null || shiftDataAfter === void 0 ? void 0 : shiftDataAfter.task} at ${shiftDataAfter === null || shiftDataAfter === void 0 ? void 0 : shiftDataAfter.address}.`,
            data: { url: `/dashboard` },
        };
    }
    else if (!change.after.exists() && change.before.exists()) {
        // A shift is deleted
        userId = shiftDataBefore === null || shiftDataBefore === void 0 ? void 0 : shiftDataBefore.userId;
        payload = {
            title: "Shift Cancelled",
            body: `Your shift for ${shiftDataBefore === null || shiftDataBefore === void 0 ? void 0 : shiftDataBefore.task} at ${shiftDataBefore === null || shiftDataBefore === void 0 ? void 0 : shiftDataBefore.address} has been cancelled.`,
            data: { url: `/dashboard` },
        };
    }
    else if (change.after.exists() && change.before.exists()) {
        // A shift is updated. This is the definitive check for meaningful changes.
        const before = shiftDataBefore;
        const after = shiftDataAfter;
        if (!before || !after) {
            functions.logger.log("Shift update detected, but data is missing. No notification sent.");
            return;
        }
        // --- Robust comparison logic ---
        const changedFields = [];
        // 1. Compare string values, tolerant of whitespace and null/undefined differences.
        if (((_c = before.task) !== null && _c !== void 0 ? _c : "").trim() !== ((_d = after.task) !== null && _d !== void 0 ? _d : "").trim()) {
            changedFields.push('task');
        }
        if (((_e = before.address) !== null && _e !== void 0 ? _e : "").trim() !== (after.address || "").trim()) {
            changedFields.push('location');
        }
        if ((before.bNumber || "").trim() !== (after.bNumber || "").trim()) {
            changedFields.push('B Number');
        }
        if (before.type !== after.type) {
            changedFields.push('time (AM/PM)');
        }
        // 2. Compare dates with day-level precision, ignoring time-of-day.
        if (before.date && after.date && !before.date.isEqual(after.date)) {
            changedFields.push('date');
        }
        // 3. Determine if any meaningful change occurred and build the notification.
        if (changedFields.length > 0) {
            userId = after.userId;
            const changes = changedFields.join(' & ');
            const body = `The ${changes} for one of your shifts has been updated.`;
            payload = {
                title: "Your Shift Has Been Updated",
                body: body,
                data: { url: `/dashboard` },
            };
            functions.logger.log(`Meaningful change detected for shift ${shiftId}. Changes: ${changes}. Sending notification.`);
        }
        else {
            // This is the crucial part: No meaningful change was detected, so no notification will be sent.
            functions.logger.log(`Shift ${shiftId} was updated, but no significant fields changed. No notification sent.`);
            return;
        }
    }
    else {
        functions.logger.log(`Shift ${shiftId} write event occurred, but it was not a create, update, or delete. No notification sent.`);
        return;
    }
    if (!userId || !payload) {
        functions.logger.log("No notification necessary for this event.", { shiftId });
        return;
    }
    functions.logger.log(`Preparing to send notification for userId: ${userId}`);
    const subscriptionsSnapshot = await db
        .collection("users")
        .doc(userId)
        .collection("pushSubscriptions")
        .withConverter(pushSubscriptionConverter) // Apply the converter here
        .get();
    if (subscriptionsSnapshot.empty) {
        functions.logger.warn(`User ${userId} has no push subscriptions. Cannot send notification.`);
        return;
    }
    functions.logger.log(`Found ${subscriptionsSnapshot.size} subscriptions for user ${userId}.`);
    const sendPromises = subscriptionsSnapshot.docs.map((subDoc) => {
        // Thanks to the converter, subDoc.data() is now correctly typed as PushSubscription.
        const subscription = subDoc.data();
        return webPush.sendNotification(subscription, JSON.stringify(payload)).catch((error) => {
            functions.logger.error(`Error sending notification to user ${userId}:`, error);
            if (error.statusCode === 410 || error.statusCode === 404) {
                functions.logger.log(`Deleting invalid subscription for user ${userId}.`);
                return subDoc.ref.delete();
            }
            return null;
        });
    });
    await Promise.all(sendPromises);
    functions.logger.log(`Finished sending notifications for shift ${shiftId}.`);
});
exports.projectReviewNotifier = functions
    .region("europe-west2")
    .pubsub.schedule("every 24 hours")
    .onRun(async (context) => {
    var _a, _b;
    functions.logger.log("Running daily project review notifier.");
    // --- Master Notification Toggle Check ---
    const settingsRef = db.collection('settings').doc('notifications');
    const settingsDoc = await settingsRef.get();
    if (settingsDoc.exists() && settingsDoc.data()?.enabled === false) {
        functions.logger.log('Global notifications are disabled by the owner. Aborting project review notifier.');
        return;
    }
    const config = functions.config();
    const publicKey = (_a = config.webpush) === null || _a === void 0 ? void 0 : _a.public_key;
    const privateKey = (_b = config.webpush) === null || _b === void 0 ? void 0 : _b.private_key;
    if (!publicKey || !privateKey) {
        functions.logger.error("CRITICAL: VAPID keys are not configured. Cannot send project review notifications.");
        return;
    }
    webPush.setVapidDetails("mailto:example@your-project.com", publicKey, privateKey);
    const now = admin.firestore.Timestamp.now();
    const projectsToReviewQuery = db.collection("projects").where("nextReviewDate", "<=", now);
    try {
        const querySnapshot = await projectsToReviewQuery.get();
        if (querySnapshot.empty) {
            functions.logger.log("No projects due for review today.");
            return;
        }
        functions.logger.log(`Found ${querySnapshot.size} projects to review.`);
        const batch = db.batch();
        for (const projectDoc of querySnapshot.docs) {
            const projectData = projectDoc.data();
            const { creatorId, address } = projectData;
            if (!creatorId) {
                functions.logger.warn(`Project ${projectDoc.id} (${address}) is due for review but has no creatorId. Skipping.`);
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
                functions.logger.warn(`Creator ${creatorId} for project ${address} has no push subscriptions.`);
            }
            else {
                functions.logger.log(`Sending review notification for project ${address} to creator ${creatorId}.`);
                const sendPromises = subscriptionsSnapshot.docs.map((subDoc) => {
                    const subscription = subDoc.data();
                    return webPush.sendNotification(subscription, payload).catch((error) => {
                        functions.logger.error(`Error sending notification to user ${creatorId}:`, error);
                        if (error.statusCode === 410 || error.statusCode === 404) {
                            functions.logger.log(`Deleting invalid subscription for user ${creatorId}.`);
                            return subDoc.ref.delete();
                        }
                        return null;
                    });
                });
                await Promise.all(sendPromises);
            }
            // Update the next review date for this project
            const newReviewDate = new Date();
            newReviewDate.setDate(newReviewDate.getDate() + 28); // 4 weeks from now
            batch.update(projectDoc.ref, { nextReviewDate: admin.firestore.Timestamp.fromDate(newReviewDate) });
        }
        // Commit all the project updates at once.
        await batch.commit();
        functions.logger.log("Finished processing project reviews and updated next review dates.");
    }
    catch (error) {
        functions.logger.error("Error running project review notifier:", error);
    }
});
exports.deleteProjectAndFiles = functions.region("europe-west2").https.onCall(async (data, context) => {
    functions.logger.log("Received request to delete project:", data.projectId);
    // 1. Authentication check
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "You must be logged in to delete a project.");
    }
    const uid = context.auth.uid;
    const userDoc = await db.collection("users").doc(uid).get();
    const userProfile = userDoc.data();
    if (!userProfile || !['admin', 'owner'].includes(userProfile.role)) {
        throw new functions.https.HttpsError("permission-denied", "You do not have permission to perform this action.");
    }
    const projectId = data.projectId;
    if (!projectId || typeof projectId !== 'string') {
        throw new functions.https.HttpsError("invalid-argument", "The function must be called with a 'projectId' string argument.");
    }
    try {
        const bucket = admin.storage().bucket();
        const prefix = `project_files/${projectId}/`;
        // Step 1: Atomically delete all associated files from Cloud Storage using a prefix match.
        // This is more robust than relying on file paths stored in Firestore.
        await bucket.deleteFiles({ prefix });
        functions.logger.log(`Successfully deleted all files with prefix "${prefix}" from Storage.`);
        // Step 2: Delete all documents from the 'files' subcollection in Firestore.
        const projectRef = db.collection('projects').doc(projectId);
        const filesQuerySnapshot = await projectRef.collection('files').get();
        const batch = db.batch();
        filesQuerySnapshot.forEach(doc => {
            batch.delete(doc.ref);
        });
        // Step 3: Delete the main project document itself.
        batch.delete(projectRef);
        // Step 4: Commit all Firestore deletions in a single atomic operation.
        await batch.commit();
        functions.logger.log(`Successfully deleted project ${projectId} and its subcollections from Firestore.`);
        return { success: true, message: `Project ${projectId} and all associated files deleted successfully.` };
    }
    catch (error) {
        functions.logger.error(`Error deleting project ${projectId}:`, error);
        // Avoid leaking detailed internal error messages to the client.
        throw new functions.https.HttpsError("internal", "An unexpected error occurred while deleting the project. Please check the function logs.");
    }
});
exports.deleteProjectFile = functions.region("europe-west2").https.onCall(async (data, context) => {
    functions.logger.log("Received request to delete file:", data);
    // 1. Auth check
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "You must be logged in to delete a file.");
    }
    const uid = context.auth.uid;
    const { projectId, fileId } = data;
    if (!projectId || typeof projectId !== 'string' || !fileId || typeof fileId !== 'string') {
        throw new functions.https.HttpsError("invalid-argument", "The function requires 'projectId' and 'fileId' arguments.");
    }
    try {
        const fileRef = db.collection('projects').doc(projectId).collection('files').doc(fileId);
        const fileDoc = await fileRef.get();
        if (!fileDoc.exists) {
            throw new functions.https.HttpsError("not-found", "The specified file does not exist.");
        }
        const fileData = fileDoc.data();
        // Robustly check for corrupt or incomplete data
        if (!fileData || !fileData.fullPath || !fileData.uploaderId) {
            functions.logger.error(`File document ${fileId} in project ${projectId} is missing required data ('fullPath' or 'uploaderId'). Deleting Firestore record.`, { fileData });
            // Attempt to clean up the bad Firestore record
            await fileRef.delete();
            throw new functions.https.HttpsError("internal", "The file's database record was corrupt and has been removed. The file may still exist in storage.");
        }
        const uploaderId = fileData.uploaderId;
        // 2. Permission check: Is the user the uploader, or an admin/owner?
        const userDoc = await db.collection("users").doc(uid).get();
        const userProfile = userDoc.data();
        const isOwnerOrAdmin = userProfile && ['admin', 'owner'].includes(userProfile.role);
        const isUploader = uid === uploaderId;
        if (!isOwnerOrAdmin && !isUploader) {
            throw new functions.https.HttpsError("permission-denied", "You do not have permission to delete this file.");
        }
        // 3. Deletion Logic
        // Delete from Storage first, using the full path stored in the document.
        const storageFileRef = admin.storage().bucket().file(fileData.fullPath);
        await storageFileRef.delete();
        functions.logger.log(`Successfully deleted file from Storage: ${fileData.fullPath}`);
        // Then delete the file record from Firestore.
        await fileRef.delete();
        functions.logger.log(`Successfully deleted file record from Firestore: ${fileId}`);
        return { success: true, message: `File ${fileId} deleted successfully.` };
    }
    catch (error) {
        functions.logger.error(`Error deleting file ${fileId} from project ${projectId}:`, error);
        if (error instanceof functions.https.HttpsError) {
            throw error; // Re-throw HttpsError so client gets the specific message
        }
        throw new functions.https.HttpsError("internal", "An unexpected error occurred while deleting the file. Please check the function logs.");
    }
});
exports.deleteAllShifts = functions.region("europe-west2").https.onCall(async (data, context) => {
    // 1. Authentication check
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "You must be logged in.");
    }
    const uid = context.auth.uid;
    const userDoc = await db.collection("users").doc(uid).get();
    const userProfile = userDoc.data();
    if (!userProfile || userProfile.role !== 'owner') {
        throw new functions.https.HttpsError("permission-denied", "Only the account owner can perform this action.");
    }
    functions.logger.log(`Owner ${uid} initiated deletion of all shifts.`);
    try {
        const shiftsCollection = db.collection('shifts');
        const snapshot = await shiftsCollection.get();
        if (snapshot.empty) {
            return { success: true, message: "No shifts to delete." };
        }
        const batchSize = 500;
        const batches = [];
        for (let i = 0; i < snapshot.docs.length; i += batchSize) {
            const batch = db.batch();
            const chunk = snapshot.docs.slice(i, i + batchSize);
            chunk.forEach(doc => batch.delete(doc.ref));
            batches.push(batch.commit());
        }
        await Promise.all(batches);
        functions.logger.log(`Successfully deleted ${snapshot.size} shifts.`);
        return { success: true, message: `Successfully deleted ${snapshot.size} shifts.` };
    }
    catch (error) {
        functions.logger.error("Error deleting all shifts:", error);
        throw new functions.https.HttpsError("internal", "An unexpected error occurred while deleting shifts.");
    }
});
exports.deleteAllProjects = functions.region("europe-west2").https.onCall(async (data, context) => {
    // 1. Authentication check
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "You must be logged in.");
    }
    const uid = context.auth.uid;
    const userDoc = await db.collection("users").doc(uid).get();
    const userProfile = userDoc.data();
    if (!userProfile || userProfile.role !== 'owner') {
        throw new functions.https.HttpsError("permission-denied", "Only the account owner can perform this action.");
    }
    functions.logger.log(`Owner ${uid} initiated deletion of ALL projects and files.`);
    try {
        const projectsQuerySnapshot = await db.collection('projects').get();
        if (projectsQuerySnapshot.empty) {
            return { success: true, message: "No projects to delete." };
        }
        const bucket = admin.storage().bucket();
        // Step 1: Delete all files from storage first.
        const storagePromises = projectsQuerySnapshot.docs.map(projectDoc => {
            const prefix = `project_files/${projectDoc.id}/`;
            return bucket.deleteFiles({ prefix });
        });
        await Promise.all(storagePromises);
        functions.logger.log("Successfully deleted all project files from Storage.");
        // Step 2: Delete all Firestore data (projects and their file subcollections)
        const firestoreDeletions = [];
        for (const projectDoc of projectsQuerySnapshot.docs) {
            const filesCollectionRef = projectDoc.ref.collection('files');
            const filesSnapshot = await filesCollectionRef.get();
            if (!filesSnapshot.empty) {
                const batchSize = 500;
                for (let i = 0; i < filesSnapshot.docs.length; i += batchSize) {
                    const batch = db.batch();
                    const chunk = filesSnapshot.docs.slice(i, i + batchSize);
                    chunk.forEach(doc => batch.delete(doc.ref));
                    firestoreDeletions.push(batch.commit());
                }
            }
            // Delete the project doc itself in a separate operation
            firestoreDeletions.push(projectDoc.ref.delete());
        }
        await Promise.all(firestoreDeletions);
        functions.logger.log("Successfully deleted all projects and their subcollections from Firestore.");
        return { success: true, message: `Successfully deleted ${projectsQuerySnapshot.size} projects and all associated files.` };
    }
    catch (error) {
        functions.logger.error("Error deleting all projects:", error);
        throw new functions.https.HttpsError("internal", "An error occurred while deleting all projects. Please check the function logs.");
    }
});
//# sourceMappingURL=index.js.map
