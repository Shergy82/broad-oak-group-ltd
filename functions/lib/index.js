"use strict";
/* functions/src/index.ts */
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
exports.zipProjectFiles = exports.syncUserNamesToShifts = exports.deleteUser = exports.setUserStatus = exports.deleteAllProjects = exports.deleteAllShifts = exports.deleteProjectFile = exports.deleteProjectAndFiles = exports.pendingShiftNotifier = exports.projectReviewNotifier = exports.sendShiftNotification = exports.setNotificationStatus = exports.getNotificationStatus = exports.getVapidPublicKey = void 0;
const functions = __importStar(require("firebase-functions")); // v1 (firestore triggers, schedules, legacy onCall)
const https_1 = require("firebase-functions/v2/https"); // v2 callable (modern)
const logger = __importStar(require("firebase-functions/logger"));
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const webPush = __importStar(require("web-push"));
if (firebase_admin_1.default.apps.length === 0)
    firebase_admin_1.default.initializeApp();
const db = firebase_admin_1.default.firestore();
/**
 * ---------- VAPID / Web Push helpers ----------
 * We use ONLY process.env.* (NOT functions.config()) so it works in Gen2 and avoids the runtime-config shutdown.
 * Ensure these exist in your function env:
 *  - WEBPUSH_PUBLIC_KEY=...
 *  - WEBPUSH_PRIVATE_KEY=...
 *  - WEBPUSH_SUBJECT=mailto:you@yourdomain.com   (optional)
 */
function getVapidEnv() {
    const publicKey = process.env.WEBPUSH_PUBLIC_KEY || "";
    const privateKey = process.env.WEBPUSH_PRIVATE_KEY || "";
    const subject = process.env.WEBPUSH_SUBJECT || "mailto:example@your-project.com";
    return { publicKey, privateKey, subject };
}
function ensureVapidConfiguredOrLog() {
    const { publicKey, privateKey, subject } = getVapidEnv();
    if (!publicKey || !privateKey) {
        functions.logger.error("CRITICAL: VAPID keys are not configured. Missing WEBPUSH_PUBLIC_KEY and/or WEBPUSH_PRIVATE_KEY in env.");
        return { ok: false };
    }
    webPush.setVapidDetails(subject, publicKey, privateKey);
    return { ok: true };
}
function subIdFromEndpoint(endpoint) {
    return Buffer.from(endpoint).toString("base64").replace(/=+$/g, "");
}
/**
 * ---------- PushSubscription Firestore converter ----------
 * Stores exactly what web-push expects: { endpoint, keys: {p256dh, auth} }
 */
const pushSubscriptionConverter = {
    toFirestore(subscription) {
        return { endpoint: subscription.endpoint, keys: subscription.keys };
    },
    fromFirestore(snapshot) {
        const data = snapshot.data();
        if (!data?.endpoint || !data?.keys?.p256dh || !data?.keys?.auth) {
            throw new Error("Invalid PushSubscription data from Firestore.");
        }
        return {
            endpoint: data.endpoint,
            keys: {
                p256dh: data.keys.p256dh,
                auth: data.keys.auth,
            },
        };
    },
};
/**
 * ---------- Shared push sender ----------
 * Logs per-subscription success/failure and returns summary counts.
 * Also deletes dead subs (410/404).
 */
async function sendToSubscriptions(uid, subsSnap, payloadObj, contextLabel) {
    const payload = JSON.stringify(payloadObj);
    const results = await Promise.all(subsSnap.docs.map(async (subDoc) => {
        const subscription = subDoc.data();
        try {
            await webPush.sendNotification(subscription, payload);
            functions.logger.log(`Push sent OK (${contextLabel}) uid=${uid} subDoc=${subDoc.id}`);
            return { ok: true, id: subDoc.id };
        }
        catch (error) {
            const code = error?.statusCode;
            functions.logger.error(`Push send FAILED (${contextLabel}) uid=${uid} subDoc=${subDoc.id} status=${code}`, error);
            if (code === 410 || code === 404) {
                functions.logger.log(`Deleting invalid subscription uid=${uid} subDoc=${subDoc.id} (${contextLabel})`);
                await subDoc.ref.delete().catch(() => { });
                return { ok: false, id: subDoc.id, deleted: true, status: code };
            }
            return { ok: false, id: subDoc.id, status: code };
        }
    }));
    const okCount = results.filter((r) => r.ok).length;
    const failCount = results.length - okCount;
    return { okCount, failCount, total: results.length, results };
}
/**
 * ---------- Callable: getVapidPublicKey ----------
 * Public key only, safe to return to clients.
 */
exports.getVapidPublicKey = (0, https_1.onCall)({ region: "europe-west2" }, async () => {
    const { publicKey } = getVapidEnv();
    if (!publicKey) {
        logger.error("WEBPUSH_PUBLIC_KEY is not set.");
        throw new https_1.HttpsError("not-found", "VAPID public key is not configured on the server.");
    }
    return { publicKey };
});
/**
 * ---------- Callable: getNotificationStatus ----------
 * Owner-only: reads global enable/disable flag.
 */
exports.getNotificationStatus = (0, https_1.onCall)({ region: "europe-west2" }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "You must be logged in to perform this action.");
    }
    const uid = request.auth.uid;
    const userDoc = await db.collection("users").doc(uid).get();
    const userProfile = userDoc.data();
    if (!userProfile || userProfile.role !== "owner") {
        throw new https_1.HttpsError("permission-denied", "Only the account owner can view notification settings.");
    }
    try {
        const settingsRef = db.collection("settings").doc("notifications");
        const docSnap = await settingsRef.get();
        if (docSnap.exists && docSnap.data()?.enabled === false)
            return { enabled: false };
        return { enabled: true };
    }
    catch (error) {
        logger.error("Error reading notification settings:", error);
        throw new https_1.HttpsError("internal", "An unexpected error occurred while reading the settings.");
    }
});
/**
 * ---------- Callable: setNotificationStatus ----------
 * - Owner-only: global toggle (data.enabled boolean)
 * - Any logged-in user: save/remove THEIR OWN subscription
 */
exports.setNotificationStatus = (0, https_1.onCall)({ region: "europe-west2" }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "You must be logged in.");
    }
    const uid = request.auth.uid;
    const data = (request.data || {});
    // ---- Owner-only: global toggle ----
    if (typeof data.enabled === "boolean") {
        const userDoc = await db.collection("users").doc(uid).get();
        const userProfile = userDoc.data();
        if (!userProfile || userProfile.role !== "owner") {
            throw new https_1.HttpsError("permission-denied", "Only the account owner can change global notification settings.");
        }
        await db.collection("settings").doc("notifications").set({ enabled: data.enabled }, { merge: true });
        return { success: true, enabled: data.enabled };
    }
    // ---- Any logged-in user: subscribe (save subscription) ----
    if (data.status === "subscribed") {
        const sub = data.subscription;
        if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
            throw new https_1.HttpsError("invalid-argument", "Missing or invalid subscription payload.");
        }
        const subId = subIdFromEndpoint(sub.endpoint);
        await db
            .collection("users")
            .doc(uid)
            .collection("pushSubscriptions")
            .doc(subId)
            .set({
            endpoint: sub.endpoint,
            keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
            updatedAt: firebase_admin_1.default.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        return { success: true, status: "subscribed" };
    }
    // ---- Any logged-in user: unsubscribe (remove subscription) ----
    if (data.status === "unsubscribed") {
        // allow either endpoint string OR subscription object
        const endpoint = data.endpoint || data.subscription?.endpoint;
        if (!endpoint || typeof endpoint !== "string") {
            throw new https_1.HttpsError("invalid-argument", "Missing endpoint.");
        }
        const subId = subIdFromEndpoint(endpoint);
        await db
            .collection("users")
            .doc(uid)
            .collection("pushSubscriptions")
            .doc(subId)
            .delete()
            .catch(() => { });
        return { success: true, status: "unsubscribed" };
    }
    throw new https_1.HttpsError("invalid-argument", "Invalid request.");
});
/**
 * ---------- Firestore trigger: sendShiftNotification ----------
 * Uses ONLY process.env WEBPUSH_* keys (no functions.config).
 */
exports.sendShiftNotification = functions
    .region("europe-west2")
    .firestore.document("shifts/{shiftId}")
    .onWrite(async (change, context) => {
    const shiftId = context.params.shiftId;
    functions.logger.log(`Function triggered for shiftId: ${shiftId}`);
    // --- Master Notification Toggle Check (global) ---
    const settingsDoc = await db.collection("settings").doc("notifications").get();
    if (settingsDoc.exists && settingsDoc.data()?.enabled === false) {
        functions.logger.log("Global notifications are disabled by the owner. Aborting.");
        return;
    }
    // --- Ensure VAPID keys exist ---
    const vapidOk = ensureVapidConfiguredOrLog();
    if (!vapidOk.ok)
        return;
    const shiftDataBefore = change.before.data();
    const shiftDataAfter = change.after.data();
    let userId = null;
    let payload = null;
    if (change.after.exists && !change.before.exists) {
        userId = shiftDataAfter?.userId;
        payload = {
            title: "New Shift Assigned",
            body: `You have a new shift: ${shiftDataAfter?.task || ""} at ${shiftDataAfter?.address || ""}.`,
            data: { url: `/dashboard` },
        };
    }
    else if (!change.after.exists && change.before.exists) {
        userId = shiftDataBefore?.userId;
        payload = {
            title: "Shift Cancelled",
            body: `Your shift for ${shiftDataBefore?.task || ""} at ${shiftDataBefore?.address || ""} has been cancelled.`,
            data: { url: `/dashboard` },
        };
    }
    else if (change.after.exists && change.before.exists) {
        const before = shiftDataBefore;
        const after = shiftDataAfter;
        if (!before || !after) {
            functions.logger.log("Shift update detected, but data is missing. No notification sent.");
            return;
        }
        const changedFields = [];
        if ((before.task || "").trim() !== (after.task || "").trim())
            changedFields.push("task");
        if ((before.address || "").trim() !== (after.address || "").trim())
            changedFields.push("location");
        if ((before.bNumber || "").trim() !== (after.bNumber || "").trim())
            changedFields.push("B Number");
        if (before.type !== after.type)
            changedFields.push("time (AM/PM)");
        const beforeDate = before.date?.toMillis?.() ?? null;
        const afterDate = after.date?.toMillis?.() ?? null;
        if (beforeDate !== afterDate)
            changedFields.push("date");
        if (changedFields.length > 0) {
            userId = after.userId;
            const changes = changedFields.join(" & ");
            payload = {
                title: "Your Shift Has Been Updated",
                body: `The ${changes} for one of your shifts has been updated.`,
                data: { url: `/dashboard` },
            };
            functions.logger.log(`Meaningful change detected for shift ${shiftId}. Changes: ${changes}. Sending notification.`);
        }
        else {
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
    const subsSnap = await db
        .collection("users")
        .doc(userId)
        .collection("pushSubscriptions")
        .withConverter(pushSubscriptionConverter)
        .get();
    if (subsSnap.empty) {
        functions.logger.warn(`User ${userId} has no push subscriptions. Cannot send notification.`);
        return;
    }
    functions.logger.log(`Found ${subsSnap.size} subscriptions for user ${userId}.`);
    const { okCount, failCount } = await sendToSubscriptions(userId, subsSnap, payload, `sendShiftNotification shiftId=${shiftId}`);
    functions.logger.log(`Finished sending notifications for shift ${shiftId}. ok=${okCount} fail=${failCount}`);
});
/**
 * ---------- Scheduled: projectReviewNotifier ----------
 * Uses env-based VAPID keys.
 */
exports.projectReviewNotifier = functions
    .region("europe-west2")
    .pubsub.schedule("every 24 hours")
    .onRun(async () => {
    functions.logger.log("Running daily project review notifier.");
    const settingsDoc = await db.collection("settings").doc("notifications").get();
    if (settingsDoc.exists && settingsDoc.data()?.enabled === false) {
        functions.logger.log("Global notifications are disabled by the owner. Aborting project review notifier.");
        return;
    }
    const vapidOk = ensureVapidConfiguredOrLog();
    if (!vapidOk.ok)
        return;
    const now = firebase_admin_1.default.firestore.Timestamp.now();
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
            const payloadObj = {
                title: "Project Review Reminder",
                body: `It's time to review the project at ${address}. Please check if it can be archived.`,
                data: { url: "/projects" },
            };
            const subsSnap = await db
                .collection("users")
                .doc(creatorId)
                .collection("pushSubscriptions")
                .withConverter(pushSubscriptionConverter)
                .get();
            if (subsSnap.empty) {
                functions.logger.warn(`Creator ${creatorId} for project ${address} has no push subscriptions.`);
            }
            else {
                functions.logger.log(`Sending review notification for project ${address} to creator ${creatorId}.`);
                const { okCount, failCount } = await sendToSubscriptions(creatorId, subsSnap, payloadObj, `projectReviewNotifier projectId=${projectDoc.id}`);
                functions.logger.log(`Project review push done for creator ${creatorId} (project ${projectDoc.id}). ok=${okCount} fail=${failCount}`);
            }
            const newReviewDate = new Date();
            newReviewDate.setDate(newReviewDate.getDate() + 28);
            batch.update(projectDoc.ref, { nextReviewDate: firebase_admin_1.default.firestore.Timestamp.fromDate(newReviewDate) });
        }
        await batch.commit();
        functions.logger.log("Finished processing project reviews and updated next review dates.");
    }
    catch (error) {
        functions.logger.error("Error running project review notifier:", error);
    }
});
/**
 * ---------- Scheduled: pendingShiftNotifier ----------
 * Uses env-based VAPID keys.
 */
exports.pendingShiftNotifier = functions
    .region("europe-west2")
    .pubsub.schedule("every 1 hours")
    .onRun(async () => {
    functions.logger.log("Running hourly pending shift notifier.");
    const settingsDoc = await db.collection("settings").doc("notifications").get();
    if (settingsDoc.exists && settingsDoc.data()?.enabled === false) {
        functions.logger.log("Global notifications are disabled by the owner. Aborting pending shift notifier.");
        return;
    }
    const vapidOk = ensureVapidConfiguredOrLog();
    if (!vapidOk.ok)
        return;
    try {
        const pendingShiftsQuery = db.collection("shifts").where("status", "==", "pending-confirmation");
        const querySnapshot = await pendingShiftsQuery.get();
        if (querySnapshot.empty) {
            functions.logger.log("No pending shifts found.");
            return;
        }
        const shiftsByUser = new Map();
        querySnapshot.forEach((doc) => {
            const shift = doc.data();
            if (shift.userId) {
                if (!shiftsByUser.has(shift.userId))
                    shiftsByUser.set(shift.userId, []);
                shiftsByUser.get(shift.userId).push(shift);
            }
        });
        for (const [userId, userShifts] of shiftsByUser.entries()) {
            const subsSnap = await db
                .collection("users")
                .doc(userId)
                .collection("pushSubscriptions")
                .withConverter(pushSubscriptionConverter)
                .get();
            if (subsSnap.empty) {
                functions.logger.warn(`User ${userId} has ${userShifts.length} pending shift(s) but no push subscriptions.`);
                continue;
            }
            const payloadObj = {
                title: "Pending Shifts Reminder",
                body: `You have ${userShifts.length} shift(s) awaiting your confirmation. Please review them in the app.`,
                data: { url: "/dashboard" },
            };
            functions.logger.log(`Sending reminder to user ${userId} for ${userShifts.length} pending shift(s).`);
            const { okCount, failCount } = await sendToSubscriptions(userId, subsSnap, payloadObj, `pendingShiftNotifier pendingCount=${userShifts.length}`);
            functions.logger.log(`Pending shift reminder push done for user ${userId}. ok=${okCount} fail=${failCount}`);
        }
        functions.logger.log("Finished processing pending shift reminders.");
    }
    catch (error) {
        functions.logger.error("Error running pendingShiftNotifier:", error);
    }
});
/**
 * ---------- Remaining functions (unchanged logic) ----------
 * These are still v1 https.onCall handlers (fine).
 */
exports.deleteProjectAndFiles = functions.region("europe-west2").https.onCall(async (data, context) => {
    functions.logger.log("Received request to delete project:", data?.projectId);
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "You must be logged in to delete a project.");
    }
    const uid = context.auth.uid;
    const userDoc = await db.collection("users").doc(uid).get();
    const userProfile = userDoc.data();
    if (!userProfile || !["admin", "owner"].includes(userProfile.role)) {
        throw new functions.https.HttpsError("permission-denied", "You do not have permission to perform this action.");
    }
    const projectId = data?.projectId;
    if (!projectId || typeof projectId !== "string") {
        throw new functions.https.HttpsError("invalid-argument", "The function must be called with a 'projectId' string argument.");
    }
    try {
        const bucket = firebase_admin_1.default.storage().bucket();
        const prefix = `project_files/${projectId}/`;
        await bucket.deleteFiles({ prefix });
        functions.logger.log(`Successfully deleted all files with prefix "${prefix}" from Storage.`);
        const projectRef = db.collection("projects").doc(projectId);
        const filesQuerySnapshot = await projectRef.collection("files").get();
        const batch = db.batch();
        filesQuerySnapshot.forEach((doc) => batch.delete(doc.ref));
        batch.delete(projectRef);
        await batch.commit();
        functions.logger.log(`Successfully deleted project ${projectId} and its subcollections from Firestore.`);
        return { success: true, message: `Project ${projectId} and all associated files deleted successfully.` };
    }
    catch (error) {
        functions.logger.error(`Error deleting project ${projectId}:`, error);
        throw new functions.https.HttpsError("internal", "An unexpected error occurred while deleting the project. Please check the function logs.");
    }
});
exports.deleteProjectFile = functions.region("europe-west2").https.onCall(async (data, context) => {
    functions.logger.log("Received request to delete file:", data);
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "You must be logged in to delete a file.");
    }
    const uid = context.auth.uid;
    const { projectId, fileId } = (data || {});
    if (!projectId || typeof projectId !== "string" || !fileId || typeof fileId !== "string") {
        throw new functions.https.HttpsError("invalid-argument", "The function requires 'projectId' and 'fileId' arguments.");
    }
    try {
        const fileRef = db.collection("projects").doc(projectId).collection("files").doc(fileId);
        const fileDoc = await fileRef.get();
        if (!fileDoc.exists) {
            throw new functions.https.HttpsError("not-found", "The specified file does not exist.");
        }
        const fileData = fileDoc.data();
        if (!fileData?.fullPath || !fileData?.uploaderId) {
            functions.logger.error(`File document ${fileId} in project ${projectId} is missing required data ('fullPath' or 'uploaderId'). Deleting Firestore record.`, { fileData });
            await fileRef.delete();
            throw new functions.https.HttpsError("internal", "The file's database record was corrupt and has been removed. The file may still exist in storage.");
        }
        const uploaderId = fileData.uploaderId;
        const userDoc = await db.collection("users").doc(uid).get();
        const userProfile = userDoc.data();
        const isOwnerOrAdmin = userProfile && ["admin", "owner"].includes(userProfile.role);
        const isUploader = uid === uploaderId;
        if (!isOwnerOrAdmin && !isUploader) {
            throw new functions.https.HttpsError("permission-denied", "You do not have permission to delete this file.");
        }
        const storageFileRef = firebase_admin_1.default.storage().bucket().file(fileData.fullPath);
        await storageFileRef.delete();
        functions.logger.log(`Successfully deleted file from Storage: ${fileData.fullPath}`);
        await fileRef.delete();
        functions.logger.log(`Successfully deleted file record from Firestore: ${fileId}`);
        return { success: true, message: `File ${fileId} deleted successfully.` };
    }
    catch (error) {
        functions.logger.error(`Error deleting file ${fileId} from project ${projectId}:`, error);
        if (error instanceof functions.https.HttpsError)
            throw error;
        throw new functions.https.HttpsError("internal", "An unexpected error occurred while deleting the file. Please check the function logs.");
    }
});
async function deleteQueryBatch(dbi, query, resolve, reject) {
    const snapshot = await query.limit(500).get();
    if (snapshot.size === 0) {
        resolve(0);
        return;
    }
    const batch = dbi.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    try {
        await batch.commit();
        process.nextTick(() => deleteQueryBatch(dbi, query, resolve, reject));
    }
    catch (error) {
        reject(error);
    }
}
exports.deleteAllShifts = (0, https_1.onCall)({ region: "europe-west2" }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "You must be logged in.");
    }
    const uid = request.auth.uid;
    const userDoc = await db.collection("users").doc(uid).get();
    const userProfile = userDoc.data();
    if (!userProfile || userProfile.role !== "owner") {
        throw new https_1.HttpsError("permission-denied", "Only the account owner can perform this action.");
    }
    logger.log(`Owner ${uid} initiated deletion of all active shifts.`);
    try {
        const activeShiftStatuses = ["pending-confirmation", "confirmed", "on-site", "rejected"];
        const shiftsCollection = db.collection("shifts");
        const q = shiftsCollection.where("status", "in", activeShiftStatuses);
        await new Promise((resolve, reject) => deleteQueryBatch(db, q, resolve, reject));
        logger.log("Successfully deleted active shifts.");
        return { success: true, message: "Successfully deleted active shifts." };
    }
    catch (error) {
        logger.error("Error deleting all shifts:", error);
        throw new https_1.HttpsError("internal", "An unexpected error occurred while deleting shifts.");
    }
});
exports.deleteAllProjects = functions.region("europe-west2").https.onCall(async (_data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "You must be logged in.");
    }
    const uid = context.auth.uid;
    const userDoc = await db.collection("users").doc(uid).get();
    const userProfile = userDoc.data();
    if (!userProfile || userProfile.role !== "owner") {
        throw new functions.https.HttpsError("permission-denied", "Only the account owner can perform this action.");
    }
    functions.logger.log(`Owner ${uid} initiated deletion of ALL projects and files.`);
    try {
        const projectsQuerySnapshot = await db.collection("projects").get();
        if (projectsQuerySnapshot.empty)
            return { success: true, message: "No projects to delete." };
        const bucket = firebase_admin_1.default.storage().bucket();
        await Promise.all(projectsQuerySnapshot.docs.map((projectDoc) => {
            const prefix = `project_files/${projectDoc.id}/`;
            return bucket.deleteFiles({ prefix });
        }));
        functions.logger.log("Successfully deleted all project files from Storage.");
        const firestoreDeletions = [];
        for (const projectDoc of projectsQuerySnapshot.docs) {
            const filesCollectionRef = projectDoc.ref.collection("files");
            const filesSnapshot = await filesCollectionRef.get();
            if (!filesSnapshot.empty) {
                const batchSize = 500;
                for (let i = 0; i < filesSnapshot.docs.length; i += batchSize) {
                    const batch = db.batch();
                    const chunk = filesSnapshot.docs.slice(i, i + batchSize);
                    chunk.forEach((doc) => batch.delete(doc.ref));
                    firestoreDeletions.push(batch.commit());
                }
            }
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
exports.setUserStatus = functions.region("europe-west2").https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "You must be logged in.");
    }
    const callerUid = context.auth.uid;
    const callerDoc = await db.collection("users").doc(callerUid).get();
    const callerProfile = callerDoc.data();
    if (!callerProfile || callerProfile.role !== "owner") {
        throw new functions.https.HttpsError("permission-denied", "Only the account owner can change user status.");
    }
    const { uid, disabled, newStatus } = (data || {});
    const validStatuses = ["active", "suspended", "pending-approval"];
    if (typeof uid !== "string" || typeof disabled !== "boolean" || !validStatuses.includes(newStatus)) {
        throw new functions.https.HttpsError("invalid-argument", `Invalid arguments provided. 'uid' must be a string, 'disabled' a boolean, and 'newStatus' must be one of ${validStatuses.join(", ")}.`);
    }
    if (uid === callerUid) {
        throw new functions.https.HttpsError("permission-denied", "The account owner cannot suspend their own account.");
    }
    try {
        await firebase_admin_1.default.auth().updateUser(uid, { disabled });
        await db.collection("users").doc(uid).update({ status: newStatus });
        functions.logger.log(`Owner ${callerUid} has set user ${uid} to status: ${newStatus} (Auth disabled: ${disabled}).`);
        return { success: true };
    }
    catch (error) {
        functions.logger.error(`Error updating status for user ${uid}:`, error);
        throw new functions.https.HttpsError("internal", `An unexpected error occurred while updating user status: ${error.message}`);
    }
});
exports.deleteUser = functions.region("europe-west2").https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "You must be logged in.");
    }
    const callerUid = context.auth.uid;
    const callerDoc = await db.collection("users").doc(callerUid).get();
    const callerProfile = callerDoc.data();
    if (!callerProfile || callerProfile.role !== "owner") {
        throw new functions.https.HttpsError("permission-denied", "Only the account owner can delete users.");
    }
    const { uid } = (data || {});
    if (typeof uid !== "string") {
        throw new functions.https.HttpsError("invalid-argument", "The function requires a 'uid' (string) argument.");
    }
    if (uid === callerUid) {
        throw new functions.https.HttpsError("permission-denied", "The account owner cannot delete their own account.");
    }
    try {
        const subsRef = db.collection("users").doc(uid).collection("pushSubscriptions");
        const subsSnap = await subsRef.get();
        if (!subsSnap.empty) {
            const batch = db.batch();
            subsSnap.docs.forEach((doc) => batch.delete(doc.ref));
            await batch.commit();
            functions.logger.log(`Deleted ${subsSnap.size} push subscriptions for user ${uid}.`);
        }
        await db.collection("users").doc(uid).delete();
        functions.logger.log(`Deleted Firestore document for user ${uid}.`);
        await firebase_admin_1.default.auth().deleteUser(uid);
        functions.logger.log(`Deleted Firebase Auth user ${uid}.`);
        functions.logger.log(`Owner ${callerUid} successfully deleted user ${uid}`);
        return { success: true };
    }
    catch (error) {
        functions.logger.error(`Error deleting user ${uid}:`, error);
        if (error?.code === "auth/user-not-found") {
            functions.logger.warn(`User ${uid} was already deleted from Firebase Auth. Continuing cleanup.`);
            return { success: true, message: "User was already deleted from Authentication. Cleanup finished." };
        }
        throw new functions.https.HttpsError("internal", `An unexpected error occurred while deleting the user: ${error.message}`);
    }
});
exports.syncUserNamesToShifts = functions.region("europe-west2").https.onCall(async (_data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "You must be logged in.");
    }
    const callerDoc = await db.collection("users").doc(context.auth.uid).get();
    if (callerDoc.data()?.role !== "owner") {
        throw new functions.https.HttpsError("permission-denied", "Only the account owner can run this utility.");
    }
    functions.logger.log("Starting utility to sync user names to shifts.");
    try {
        const usersSnapshot = await db.collection("users").get();
        const userMap = new Map();
        usersSnapshot.forEach((doc) => {
            userMap.set(doc.id, doc.data().name);
        });
        const shiftsSnapshot = await db.collection("shifts").get();
        if (shiftsSnapshot.empty) {
            return { success: true, message: "No shifts found to process." };
        }
        const batchSize = 400;
        let writeCount = 0;
        let totalUpdated = 0;
        let batch = db.batch();
        for (const shiftDoc of shiftsSnapshot.docs) {
            const shiftData = shiftDoc.data();
            if (shiftData.userId && userMap.has(shiftData.userId) && shiftData.userName !== userMap.get(shiftData.userId)) {
                batch.update(shiftDoc.ref, { userName: userMap.get(shiftData.userId) });
                writeCount++;
                totalUpdated++;
            }
            if (writeCount >= batchSize) {
                await batch.commit();
                functions.logger.log(`Committed a batch of ${writeCount} updates.`);
                batch = db.batch();
                writeCount = 0;
            }
        }
        if (writeCount > 0) {
            await batch.commit();
            functions.logger.log(`Committed the final batch of ${writeCount} updates.`);
        }
        functions.logger.log(`Sync complete. Total shifts updated: ${totalUpdated}.`);
        return { success: true, message: `Sync complete. ${totalUpdated} shifts were updated with the correct user name.` };
    }
    catch (error) {
        functions.logger.error("Error syncing user names to shifts:", error);
        throw new functions.https.HttpsError("internal", "An unexpected error occurred during the sync process.");
    }
});
exports.zipProjectFiles = functions.region("europe-west2").https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "You must be logged in.");
    }
    const { projectId } = (data || {});
    if (!projectId) {
        throw new functions.https.HttpsError("invalid-argument", "Missing projectId.");
    }
    const JSZip = await Promise.resolve().then(() => __importStar(require("jszip")));
    const zip = new JSZip.default();
    const bucket = firebase_admin_1.default.storage().bucket();
    try {
        const [files] = await bucket.getFiles({ prefix: `project_files/${projectId}/` });
        if (files.length === 0) {
            throw new functions.https.HttpsError("not-found", "No files found for this project.");
        }
        await Promise.all(files.map(async (file) => {
            const fileContents = await file.download();
            const fileName = file.name.split("/").pop() || file.name;
            zip.file(fileName, fileContents[0]);
        }));
        const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
        const zipFileName = `project_${projectId}_files.zip`;
        const file = bucket.file(`temp_zips/${zipFileName}`);
        await file.save(zipBuffer, { contentType: "application/zip" });
        const [signedUrl] = await file.getSignedUrl({
            action: "read",
            expires: Date.now() + 15 * 60 * 1000,
        });
        return { downloadUrl: signedUrl };
    }
    catch (error) {
        functions.logger.error(`Error zipping files for project ${projectId}:`, error);
        throw new functions.https.HttpsError("internal", error.message || "Failed to zip files.");
    }
});
//# sourceMappingURL=index.js.map