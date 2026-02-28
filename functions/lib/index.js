
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
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
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
    if (!uid) {
        throw new https_1.HttpsError("unauthenticated", "Authentication required");
    }
};
const assertIsOwner = async (uid) => {
    assertAuthenticated(uid);
    const snap = await db.collection("users").doc(uid).get();
    if (snap.data()?.role !== "owner") {
        throw new https_1.HttpsError("permission-denied", "Owner role required");
    }
};
const assertAdminOrManager = async (uid) => {
    assertAuthenticated(uid);
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
    const data = req.data;
    if (!data || typeof data !== "object") {
        throw new https_1.HttpsError("invalid-argument", "Request data must be an object.");
    }
    const enabled = data.enabled;
    const subscription = data.subscription;
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
    assertAuthenticated(req.auth?.uid);
    await assertAdminOrManager(req.auth.uid);
    const data = req.data;
    if (!data || typeof data !== "object") {
        throw new https_1.HttpsError("invalid-argument", "Request data must be an object.");
    }
    const { uid, disabled, newStatus, department } = data;
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
    const data = req.data;
    if (!data || typeof data !== "object") {
        throw new https_1.HttpsError("invalid-argument", "Request data must be an object.");
    }
    const uid = data.uid;
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
    assertAuthenticated(req.auth?.uid);
    await assertAdminOrManager(req.auth.uid);
    const data = req.data;
    if (!data || typeof data !== "object") {
        throw new https_1.HttpsError("invalid-argument", "Request data must be an object.");
    }
    const projectId = data.projectId;
    if (typeof projectId !== 'string' || !projectId.trim()) {
        throw new https_1.HttpsError('invalid-argument', 'A projectId (string) is required.');
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
    await assertIsOwner(req.auth?.uid);
    // This is a placeholder for safety. In a real scenario, you'd iterate and delete.
    v2_1.logger.info("deleteAllProjects called by", req.auth?.uid);
    return { message: "Deletion process simulation complete. No projects were actually deleted." };
});
exports.deleteProjectFile = (0, https_1.onCall)({ region: REGION }, async (req) => {
    assertAuthenticated(req.auth?.uid);
    const uid = req.auth.uid;
    const data = req.data;
    if (!data || typeof data !== "object") {
        throw new https_1.HttpsError("invalid-argument", "Request data must be an object.");
    }
    const { projectId, fileId } = data;
    if (!projectId || !fileId) {
        throw new https_1.HttpsError('invalid-argument', 'projectId and fileId required');
    }
    const userSnap = await db.collection('users').doc(uid).get();
    const role = userSnap.data()?.role;
    const fileRef = db.collection('projects').doc(projectId).collection('files').doc(fileId);
    const fileDoc = await fileRef.get();
    if (!fileDoc.exists)
        return { success: true };
    const fileData = fileDoc.data();
    if (uid !== fileData.uploaderId && !['admin', 'owner', 'manager'].includes(role)) {
        throw new https_1.HttpsError('permission-denied', 'Not allowed');
    }
    if (fileData.fullPath) {
        await admin.storage().bucket().file(fileData.fullPath).delete().catch(() => { });
    }
    await fileRef.delete();
    return { success: true };
});
exports.zipProjectFiles = (0, https_1.onCall)({ region: REGION, timeoutSeconds: 300, memory: '1GiB' }, async (req) => {
    assertAuthenticated(req.auth?.uid);
    const data = req.data;
    if (!data || typeof data !== "object") {
        throw new https_1.HttpsError("invalid-argument", "Request data must be an object.");
    }
    const projectId = data.projectId;
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
        const fileData = doc.data();
        if (fileData.fullPath) {
            const [buf] = await bucket.file(fileData.fullPath).download();
            zip.file(fileData.name, buf);
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
    if (!req.auth?.uid) {
        throw new https_1.HttpsError("unauthenticated", "Authentication required");
    }
    await assertIsOwner(req.auth.uid);
    const data = req.data;
    if (!data || typeof data !== "object") {
        throw new https_1.HttpsError("invalid-argument", "Request data must be an object.");
    }
    const userId = data.userId;
    if (typeof userId !== "string" || !userId.trim()) {
        throw new https_1.HttpsError("invalid-argument", "A userId (string) is required.");
    }
    const userDoc = await db.collection("users").doc(userId).get();
    if (!userDoc.exists) {
        throw new https_1.HttpsError("not-found", "User not found.");
    }
    const userHomeDepartment = userDoc.data()?.department;
    const shiftsRef = db.collection("shifts");
    const unavailabilityRef = db.collection("unavailability");
    const BATCH_SIZE = 200; // Safely under 500 limit, accounting for dual deletes
    let totalDeleted = 0;
    let hasMore = true;
    if (totalDeleted === 0) {
        v2_1.logger.info(`Starting batched deletion for user ${userId}.`);
    }
    while (hasMore) {
        const snapshot = await shiftsRef
            .where("userId", "==", userId)
            .limit(BATCH_SIZE)
            .get();
        if (snapshot.empty) {
            hasMore = false;
            break;
        }
        const batch = db.batch();
        // SERIAL LOOP to prevent unhandled promise rejections
        for (const doc of snapshot.docs) {
            const shift = doc.data();
            batch.delete(doc.ref);
            if (userHomeDepartment &&
                shift.department &&
                userHomeDepartment !== shift.department) {
                const unavailDoc = await unavailabilityRef.doc(doc.id).get();
                if (unavailDoc.exists) {
                    batch.delete(unavailDoc.ref);
                }
            }
        }
        await batch.commit();
        totalDeleted += snapshot.size;
        // Add a small delay to avoid hitting rate limits on very large datasets
        await new Promise(r => setTimeout(r, 100));
    }
    return { message: `Deleted ${totalDeleted} shifts and associated records for the user.` };
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
