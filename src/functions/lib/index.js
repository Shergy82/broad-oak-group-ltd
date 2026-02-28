
"use strict";
/* =====================================================
   IMPORTS
===================================================== */
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
var __importStar = (this && this.__importStar) || function () {
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
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteScheduledProjects = exports.pendingShiftNotifier = exports.projectReviewNotifier = exports.reGeocodeAllShifts = exports.deleteAllShiftsForUser = exports.deleteAllShifts = exports.zipProjectFiles = exports.deleteProjectFile = exports.deleteAllProjects = exports.deleteProjectAndFiles = exports.onShiftCreated = exports.serveFile = exports.deleteUser = exports.setUserStatus = exports.setNotificationStatus = exports.getNotificationStatus = exports.getVapidPublicKey = void 0;
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-functions/v2/firestore");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const v2_1 = require("firebase-functions/v2");
const jszip_1 = __importDefault(require("jszip"));
const webPush = __importStar(require("web-push"));
/* =====================================================
   CONSTANTS
===================================================== */
const REGION = "europe-west2";
/* =====================================================
   BOOTSTRAP
===================================================== */
if (admin.apps.length === 0) {
    admin.initializeApp();
}
const db = admin.firestore();
/* =====================================================
   ENV
===================================================== */
const WEBPUSH_PUBLIC_KEY = process.env.WEBPUSH_PUBLIC_KEY ?? "";
const WEBPUSH_PRIVATE_KEY = process.env.WEBPUSH_PRIVATE_KEY ?? "";
const GEOCODING_KEY = process.env.GOOGLE_GEOCODING_KEY ?? "";
/* =====================================================
   VAPID CONFIG
===================================================== */
if (WEBPUSH_PUBLIC_KEY && WEBPUSH_PRIVATE_KEY) {
    try {
        webPush.setVapidDetails("mailto:example@yourdomain.org", WEBPUSH_PUBLIC_KEY, WEBPUSH_PRIVATE_KEY);
    }
    catch (err) {
        v2_1.logger.error("Failed to configure VAPID", err);
    }
}
else {
    v2_1.logger.warn("VAPID keys missing – push notifications disabled");
}
/* =====================================================
   HELPERS
===================================================== */
const assertAuthenticated = (uid) => {
    if (!uid)
        throw new https_1.HttpsError("unauthenticated", "Authentication required");
};
const assertIsOwner = async (uid) => {
    assertAuthenticated(uid);
    const snap = await db.collection("users").doc(uid).get();
    if (snap.data()?.role !== "owner") {
        throw new https_1.HttpsError("permission-denied", "Owner role required");
    }
};
const assertAdminOrManager = async (uid) => {
    const snap = await db.collection("users").doc(uid).get();
    const role = snap.data()?.role;
    if (!["admin", "owner", "manager"].includes(role)) {
        throw new https_1.HttpsError("permission-denied", "Insufficient permissions");
    }
};
const formatDateUK = (d) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
const isShiftInPast = (d) => {
    const now = new Date();
    const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const shiftUtc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    return shiftUtc < todayUtc;
};
const pendingGateUrl = () => "/dashboard?gate=pending";
/* =====================================================
   NOTIFICATIONS
===================================================== */
async function sendShiftNotification(userId, title, body, url, data = {}) {
    if (!userId || !WEBPUSH_PUBLIC_KEY || !WEBPUSH_PRIVATE_KEY)
        return;
    const userDoc = await db.collection("users").doc(userId).get();
    if (userDoc.data()?.notificationsEnabled === false)
        return;
    const subs = await db
        .collection("users")
        .doc(userId)
        .collection("pushSubscriptions")
        .get();
    if (subs.empty)
        return;
    const payload = JSON.stringify({
        title,
        body,
        data: { url, ...data },
    });
    await Promise.all(subs.docs.map(async (doc) => {
        try {
            await webPush.sendNotification(doc.data(), payload);
        }
        catch (err) {
            if ([404, 410].includes(err?.statusCode)) {
                await doc.ref.delete().catch(() => { });
            }
        }
    }));
}
/* =====================================================
   VAPID KEY (PUBLIC)
===================================================== */
exports.getVapidPublicKey = (0, https_1.onCall)({ region: REGION }, () => {
    if (!WEBPUSH_PUBLIC_KEY) {
        throw new https_1.HttpsError("not-found", "VAPID public key not configured on server.");
    }
    return { publicKey: WEBPUSH_PUBLIC_KEY };
});
/* =====================================================
   CALLABLE FUNCTIONS
===================================================== */
exports.getNotificationStatus = (0, https_1.onCall)({ region: REGION }, async (req) => {
    assertAuthenticated(req.auth?.uid);
    const snap = await db.collection("users").doc(req.auth.uid).get();
    return { enabled: snap.data()?.notificationsEnabled ?? false };
});
exports.setNotificationStatus = (0, https_1.onCall)({ region: REGION }, async (req) => {
    assertAuthenticated(req.auth?.uid);
    const { enabled, subscription } = req.data ?? {};
    if (typeof enabled !== "boolean") {
        throw new https_1.HttpsError("invalid-argument", "enabled must be boolean");
    }
    await db
        .collection("users")
        .doc(req.auth.uid)
        .set({ notificationsEnabled: enabled }, { merge: true });
    if (enabled && subscription) {
        await db
            .collection("users")
            .doc(req.auth.uid)
            .collection("pushSubscriptions")
            .doc("browser")
            .set(subscription, { merge: true });
    }
    return { success: true };
});
/* =====================================================
   USER MANAGEMENT (CALLABLE)
===================================================== */
exports.setUserStatus = (0, https_1.onCall)({ region: REGION }, async (req) => {
    await assertAdminOrManager(req.auth.uid);
    const { uid, disabled, newStatus, department } = req.data ?? {};
    if (typeof uid !== 'string' ||
        typeof disabled !== 'boolean' ||
        !['active', 'suspended'].includes(newStatus)) {
        throw new https_1.HttpsError('invalid-argument', 'Invalid input for user status update.');
    }
    const userUpdateData = { status: newStatus };
    if (department && typeof department === 'string') {
        userUpdateData.department = department;
    }
    await admin.auth().updateUser(uid, { disabled });
    await db.collection('users').doc(uid).update(userUpdateData);
    return { success: true };
});
exports.deleteUser = (0, https_1.onCall)({ region: REGION }, async (req) => {
    await assertIsOwner(req.auth?.uid);
    const { uid } = req.data ?? {};
    if (typeof uid !== 'string') {
        throw new https_1.HttpsError('invalid-argument', 'uid required');
    }
    await admin.auth().deleteUser(uid);
    await db.collection('users').doc(uid).delete();
    return { success: true };
});
/* =====================================================
   HTTP FILE SERVE
===================================================== */
exports.serveFile = (0, https_1.onRequest)({ region: REGION, cors: true }, async (req, res) => {
    const path = req.query.path;
    if (!path) {
        res.status(400).send("Missing path");
        return;
    }
    const file = admin.storage().bucket().file(path);
    const [exists] = await file.exists();
    if (!exists) {
        res.status(404).send("Not found");
        return;
    }
    file.createReadStream().pipe(res);
});
/* =====================================================
   FIRESTORE TRIGGERS
===================================================== */
exports.onShiftCreated = (0, firestore_1.onDocumentCreated)({ document: "shifts/{shiftId}", region: REGION }, async (event) => {
    const shift = event.data?.data();
    if (!shift?.userId)
        return;
    const date = shift.date?.toDate?.();
    if (!date || isShiftInPast(date))
        return;
    await sendShiftNotification(shift.userId, "New shift added", `A new shift was added for ${formatDateUK(date)}`, pendingGateUrl(), { shiftId: event.params.shiftId });
});
/* =====================================================
   PROJECT & FILE MANAGEMENT (CALLABLE)
===================================================== */
exports.deleteProjectAndFiles = (0, https_1.onCall)({ region: REGION, timeoutSeconds: 540, memory: '1GiB' }, async (req) => {
    await assertAdminOrManager(req.auth.uid);
    const { projectId } = req.data;
    if (!projectId) {
        throw new https_1.HttpsError('invalid-argument', 'projectId is required');
    }
    const bucket = admin.storage().bucket();
    const projectRef = db.collection('projects').doc(projectId);
    await bucket.deleteFiles({ prefix: `project_files/${projectId}/` }).catch(e => {
        console.warn(`Could not clean up storage for project ${projectId}, but proceeding with Firestore deletion.`, e);
    });
    const filesSnap = await projectRef.collection('files').get();
    if (!filesSnap.empty) {
        const batch = db.batch();
        filesSnap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
    }
    await projectRef.delete();
    return { success: true };
});
exports.deleteAllProjects = (0, https_1.onCall)({ region: REGION, timeoutSeconds: 540, memory: '1GiB' }, async (req) => {
    await assertIsOwner(req.auth.uid);
    // This is a placeholder for safety. In a real scenario, you'd iterate and delete.
    v2_1.logger.info("deleteAllProjects called by", req.auth?.uid);
    return { message: "Deletion process simulation complete. No projects were actually deleted." };
});
exports.deleteProjectFile = (0, https_1.onCall)({ region: REGION }, async (req) => {
    assertAuthenticated(req.auth?.uid);
    const uid = req.auth.uid;
    const { projectId, fileId } = req.data ?? {};
    if (!projectId || !fileId) {
        throw new https_1.HttpsError('invalid-argument', 'projectId and fileId required');
    }
    const userSnap = await db.collection('users').doc(uid).get();
    const role = userSnap.data()?.role;
    const fileRef = db.collection('projects').doc(projectId).collection('files').doc(fileId);
    const fileDoc = await fileRef.get();
    if (!fileDoc.exists)
        return { success: true };
    const data = fileDoc.data();
    if (uid !== data.uploaderId && !['admin', 'owner', 'manager'].includes(role)) {
        throw new https_1.HttpsError('permission-denied', 'Not allowed');
    }
    if (data.fullPath) {
        await admin.storage().bucket().file(data.fullPath).delete().catch(() => { });
    }
    await fileRef.delete();
    return { success: true };
});
exports.zipProjectFiles = (0, https_1.onCall)({ region: REGION, timeoutSeconds: 300, memory: '1GiB' }, async (req) => {
    assertAuthenticated(req.auth?.uid);
    const { projectId } = req.data ?? {};
    if (!projectId) {
        throw new https_1.HttpsError('invalid-argument', 'projectId required');
    }
    const projectDoc = await db.collection('projects').doc(projectId).get();
    if (!projectDoc.exists) {
        throw new https_1.HttpsError('not-found', 'Project not found');
    }
    const filesSnap = await projectDoc.ref.collection('files').get();
    if (filesSnap.empty) {
        throw new https_1.HttpsError('not-found', 'No files to zip.');
    }
    const zip = new jszip_1.default();
    const bucket = admin.storage().bucket();
    await Promise.all(filesSnap.docs.map(async (doc) => {
        const data = doc.data();
        if (data.fullPath) {
            const [buf] = await bucket.file(data.fullPath).download();
            zip.file(data.name, buf);
        }
    }));
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const zipPath = `archives/${projectId}/${Date.now()}.zip`;
    const file = bucket.file(zipPath);
    await file.save(buffer, { contentType: 'application/zip' });
    const [downloadUrl] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + 15 * 60 * 1000,
    });
    return { downloadUrl };
});
/* =====================================================
   SHIFTS (CALLABLE)
===================================================== */
exports.deleteAllShifts = (0, https_1.onCall)({ region: REGION }, async (req) => {
    await assertIsOwner(req.auth?.uid);
    const snap = await db.collection('shifts').get();
    if (snap.empty)
        return { message: "No shifts to delete." };
    const batch = db.batch();
    let count = 0;
    snap.docs.forEach((d) => {
        const status = d.data().status;
        if (!['completed', 'incomplete', 'rejected'].includes(status)) {
            batch.delete(d.ref);
            count++;
        }
    });
    await batch.commit();
    return { message: `Successfully deleted ${count} active shifts.` };
});
exports.deleteAllShiftsForUser = (0, https_1.onCall)({ region: REGION, timeoutSeconds: 540, memory: "1GiB" }, async (req) => {
    await assertIsOwner(req.auth?.uid);
    const { userId } = req.data;
    if (!userId) {
        throw new https_1.HttpsError('invalid-argument', 'A userId is required.');
    }
    v2_1.logger.info(`Starting deletion for user: ${userId} by admin: ${req.auth?.uid}`);
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
        v2_1.logger.error(`User with ID ${userId} not found.`);
        throw new https_1.HttpsError('not-found', `User with ID ${userId} not found.`);
    }
    const userHomeDepartment = userDoc.data()?.department;
    const shiftsRef = db.collection('shifts');
    const unavailabilityRef = db.collection('unavailability');
    const BATCH_SIZE = 200; // Keep it well under 500 to be safe with dual deletes.
    let totalDeleted = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
        v2_1.logger.info(`Querying for next batch of shifts for user ${userId}...`);
        const shiftsQuery = shiftsRef.where('userId', '==', userId).limit(BATCH_SIZE);
        const snapshot = await shiftsQuery.get();
        if (snapshot.empty) {
            v2_1.logger.info(`No more shifts found for user ${userId}. Exiting loop.`);
            break; // No more shifts to delete
        }
        v2_1.logger.info(`Found ${snapshot.size} shifts in this batch. Preparing to delete.`);
        const batch = db.batch();
        snapshot.docs.forEach(doc => {
            const shift = doc.data();
            batch.delete(doc.ref); // Add shift deletion to batch
            // If the shift was for a different department, also delete the corresponding unavailability record
            if (userHomeDepartment && shift.department && userHomeDepartment !== shift.department) {
                v2_1.logger.info(`Found cross-department shift. Deleting unavailability record ${doc.id}`);
                batch.delete(unavailabilityRef.doc(doc.id));
            }
        });
        v2_1.logger.info(`Committing batch of size ${snapshot.size}...`);
        await batch.commit();
        totalDeleted += snapshot.size;
        v2_1.logger.info(`Batch committed. Total deleted so far: ${totalDeleted}.`);
        // Add a small delay to avoid hitting rate limits on very large datasets
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (totalDeleted === 0) {
        return { message: "No shifts found for this user to delete." };
    }
    return { message: `Successfully deleted ${totalDeleted} shifts and associated records for the user.` };
});
exports.reGeocodeAllShifts = (0, https_1.onCall)({ region: REGION, timeoutSeconds: 540, memory: '1GiB' }, async (req) => {
    await assertIsOwner(req.auth?.uid);
    if (!GEOCODING_KEY) {
        throw new https_1.HttpsError('failed-precondition', 'Missing GEOCODING_KEY');
    }
    const snap = await db.collection('shifts').get();
    let updated = 0;
    for (const doc of snap.docs) {
        const addr = doc.data().address;
        if (!addr)
            continue;
        const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(addr + ', UK')}&key=${GEOCODING_KEY}`;
        const res = await fetch(url);
        const json = (await res.json());
        if (json.status === 'OK' && json.results?.length) {
            await doc.ref.update({ location: json.results[0].geometry.location });
            updated++;
        }
    }
    return { updated };
});
/* =====================================================
   SCHEDULED FUNCTIONS (FIXED)
===================================================== */
exports.projectReviewNotifier = (0, scheduler_1.onSchedule)({ schedule: "every 24 hours", region: REGION }, async (event) => {
    v2_1.logger.info("projectReviewNotifier ran", {
        scheduleTime: event.scheduleTime,
    });
});
exports.pendingShiftNotifier = (0, scheduler_1.onSchedule)({ schedule: "every 1 hours", region: REGION }, async (event) => {
    v2_1.logger.info("pendingShiftNotifier ran", {
        scheduleTime: event.scheduleTime,
    });
});
exports.deleteScheduledProjects = (0, scheduler_1.onSchedule)({
    schedule: "every day 01:00",
    region: REGION,
    timeoutSeconds: 540,
    memory: "256MiB",
}, async (event) => {
    v2_1.logger.info("Scheduled project cleanup started", {
        scheduleTime: event.scheduleTime,
    });
    // Placeholder for actual deletion logic
    v2_1.logger.info("Scheduled project cleanup finished");
});
//# sourceMappingURL=index.js.map
