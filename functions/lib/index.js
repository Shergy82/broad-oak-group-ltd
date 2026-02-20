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
exports.getVapidPublicKey = exports.pendingShiftNotifier = exports.projectReviewNotifier = exports.geocodeShiftOnCreate = exports.onShiftDeleted = exports.onShiftUpdated = exports.onShiftCreated = exports.reGeocodeAllShifts = exports.deleteAllShifts = exports.zipProjectFiles = exports.deleteProjectFile = exports.deleteProjectAndFiles = exports.serveFile = exports.deleteUser = exports.setUserStatus = exports.setNotificationStatus = exports.getNotificationStatus = void 0;
const admin = __importStar(require("firebase-admin"));
const functions = __importStar(require("firebase-functions"));
const https_1 = require("firebase-functions/v2/https");
const jszip_1 = __importDefault(require("jszip"));
const firestore_1 = require("firebase-functions/v2/firestore");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const v2_1 = require("firebase-functions/v2");
const webPush = __importStar(require("web-push"));
/* =====================================================
   Bootstrap
===================================================== */
if (admin.apps.length === 0) {
    admin.initializeApp();
}
const db = admin.firestore();
/* =====================================================
   VAPID/WebPush Configuration
===================================================== */
const WEBPUSH_PUBLIC_KEY = process.env.WEBPUSH_PUBLIC_KEY;
const WEBPUSH_PRIVATE_KEY = process.env.WEBPUSH_PRIVATE_KEY;
if (WEBPUSH_PUBLIC_KEY && WEBPUSH_PRIVATE_KEY) {
    try {
        webPush.setVapidDetails("mailto:example@yourdomain.org", WEBPUSH_PUBLIC_KEY, WEBPUSH_PRIVATE_KEY);
    }
    catch (error) {
        v2_1.logger.error("Failed to set VAPID details for web-push.", error);
    }
}
else {
    v2_1.logger.warn("WEBPUSH_PUBLIC_KEY and/or WEBPUSH_PRIVATE_KEY environment variables are not set. Push notifications will not work.");
}
/* =====================================================
   ENV
===================================================== */
const GEOCODING_KEY = process.env.GOOGLE_GEOCODING_KEY;
/* =====================================================
   HELPERS
===================================================== */
const assertAuthenticated = (uid) => {
    if (!uid) {
        throw new https_1.HttpsError('unauthenticated', 'Authentication required');
    }
};
const assertIsOwner = async (uid) => {
    assertAuthenticated(uid);
    const snap = await db.collection('users').doc(uid).get();
    if (snap.data()?.role !== 'owner') {
        throw new https_1.HttpsError('permission-denied', 'Owner role required');
    }
};
const assertAdminOrManager = async (uid) => {
    const snap = await db.collection('users').doc(uid).get();
    const role = snap.data()?.role;
    if (!['admin', 'owner', 'manager'].includes(role)) {
        throw new https_1.HttpsError('permission-denied', 'Insufficient permissions');
    }
};
function formatDateUK(d) {
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const yyyy = String(d.getUTCFullYear());
    return `${dd}/${mm}/${yyyy}`;
}
function isShiftInPast(shiftDate) {
    const now = new Date();
    const startOfTodayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const shiftDayUtc = new Date(Date.UTC(shiftDate.getUTCFullYear(), shiftDate.getUTCMonth(), shiftDate.getUTCDate()));
    return shiftDayUtc < startOfTodayUtc;
}
function absoluteLink(pathOrUrl) {
    if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
        return pathOrUrl;
    }
    return pathOrUrl;
}
function pendingGateUrl() {
    return "/dashboard?gate=pending";
}
/* =====================================================
   NOTIFICATIONS
===================================================== */
async function sendShiftNotification(userId, title, body, urlPath, data = {}) {
    if (!userId) {
        v2_1.logger.log("No userId provided, skipping notification.");
        return;
    }
    if (!WEBPUSH_PUBLIC_KEY || !WEBPUSH_PRIVATE_KEY) {
        v2_1.logger.warn("VAPID keys not configured. Cannot send push notification.");
        return;
    }
    const userDoc = await db.collection("users").doc(userId).get();
    if (userDoc.exists && userDoc.data()?.notificationsEnabled === false) {
        v2_1.logger.log("User has notifications disabled; skipping send.", { userId });
        return;
    }
    const subscriptionsSnapshot = await db.collection("users").doc(userId).collection("pushSubscriptions").get();
    if (subscriptionsSnapshot.empty) {
        v2_1.logger.log(`No push subscriptions found for user ${userId}.`);
        return;
    }
    const payload = JSON.stringify({
        title,
        body,
        data: {
            url: absoluteLink(urlPath),
            ...data,
        }
    });
    const shiftIdForLog = data.shiftId || 'unknown';
    const results = await Promise.all(subscriptionsSnapshot.docs.map(async (subDoc) => {
        const subscription = subDoc.data();
        try {
            await webPush.sendNotification(subscription, payload);
            v2_1.logger.log(`Push sent OK for user ${userId}, subDoc=${subDoc.id}`);
            return { ok: true, id: subDoc.id };
        }
        catch (error) {
            const code = error?.statusCode;
            v2_1.logger.error(`Push send FAILED for user ${userId}, subDoc=${subDoc.id}, status=${code}`, error);
            if (code === 410 || code === 404) {
                v2_1.logger.log(`Deleting invalid subscription for user ${userId}, subDoc=${subDoc.id}`);
                await subDoc.ref.delete().catch(() => { });
                return { ok: false, id: subDoc.id, deleted: true, status: code };
            }
            return { ok: false, id: subDoc.id, status: code };
        }
    }));
    const okCount = results.filter((r) => r.ok).length;
    const failCount = results.length - okCount;
    v2_1.logger.log(`Finished sending notifications for shift ${shiftIdForLog}. ok=${okCount} fail=${failCount}`);
}
exports.getNotificationStatus = (0, https_1.onCall)({ region: 'europe-west2' }, async (req) => {
    assertAuthenticated(req.auth?.uid);
    const doc = await db.collection('users').doc(req.auth.uid).get();
    return { enabled: doc.data()?.notificationsEnabled ?? false };
});
exports.setNotificationStatus = (0, https_1.onCall)({ region: 'europe-west2' }, async (req) => {
    assertAuthenticated(req.auth?.uid);
    const uid = req.auth.uid;
    const { enabled, subscription } = req.data ?? {};
    if (typeof enabled !== 'boolean') {
        throw new https_1.HttpsError('invalid-argument', 'enabled must be boolean');
    }
    await db.collection('users').doc(uid).set({ notificationsEnabled: enabled }, { merge: true });
    if (enabled && subscription) {
        await db
            .collection('users')
            .doc(uid)
            .collection('pushSubscriptions')
            .doc('browser')
            .set(subscription, { merge: true });
    }
    return { success: true };
});
/* =====================================================
   USER MANAGEMENT
===================================================== */
exports.setUserStatus = (0, https_1.onCall)({ region: 'europe-west2' }, async (req) => {
    await assertIsOwner(req.auth?.uid);
    const { uid, disabled, newStatus } = req.data ?? {};
    if (typeof uid !== 'string' ||
        typeof disabled !== 'boolean' ||
        !['active', 'suspended'].includes(newStatus)) {
        throw new https_1.HttpsError('invalid-argument', 'Invalid input');
    }
    await admin.auth().updateUser(uid, { disabled });
    await db.collection('users').doc(uid).update({ status: newStatus });
    return { success: true };
});
exports.deleteUser = (0, https_1.onCall)({ region: 'europe-west2' }, async (req) => {
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
   FILE SERVING (HTTP)
===================================================== */
exports.serveFile = (0, https_1.onRequest)({ region: "europe-west2", cors: true }, async (req, res) => {
    const path = req.query.path;
    const download = req.query.download === "1";
    if (!path) {
        res.status(400).send("Missing path");
        return;
    }
    const bucket = admin.storage().bucket();
    const file = bucket.file(path);
    try {
        const [exists] = await file.exists();
        if (!exists) {
            res.status(404).send("Not found");
            return;
        }
        const [meta] = await file.getMetadata();
        res.setHeader("Content-Type", meta.contentType || "application/octet-stream");
        if (download) {
            res.setHeader("Content-Disposition", `attachment; filename="${path.split("/").pop()}"`);
        }
        file.createReadStream().pipe(res);
    }
    catch (e) {
        console.error("Error serving file:", e);
        res.status(500).send("Internal server error");
    }
});
/* =====================================================
   PROJECT & FILE MANAGEMENT (HTTP — NOT CALLABLE)
===================================================== */
exports.deleteProjectAndFiles = (0, https_1.onRequest)({
    region: 'europe-west2',
    timeoutSeconds: 540,
    memory: '1GiB',
    cors: true,
}, async (req, res) => {
    try {
        if (req.method === 'OPTIONS') {
            res.set('Access-Control-Allow-Origin', req.headers.origin || '*');
            res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
            res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
            res.status(204).send('');
            return;
        }
        res.set('Access-Control-Allow-Origin', req.headers.origin || '*');
        if (req.method !== 'POST') {
            res.status(405).json({ error: 'Method not allowed' });
            return;
        }
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            res.status(401).json({ error: 'Authentication required' });
            return;
        }
        const idToken = authHeader.replace('Bearer ', '');
        const decoded = await admin.auth().verifyIdToken(idToken);
        await assertAdminOrManager(decoded.uid);
        const { projectId } = req.body ?? {};
        if (!projectId) {
            res.status(400).json({ error: 'projectId is required' });
            return;
        }
        const bucket = admin.storage().bucket();
        const projectRef = db.collection('projects').doc(projectId);
        await bucket.deleteFiles({ prefix: `project_files/${projectId}/` });
        const filesSnap = await projectRef.collection('files').get();
        if (!filesSnap.empty) {
            const batch = db.batch();
            filesSnap.docs.forEach((d) => batch.delete(d.ref));
            await batch.commit();
        }
        await projectRef.delete();
        res.json({ success: true });
    }
    catch (err) {
        console.error('deleteProjectAndFiles failed', err);
        if (err instanceof https_1.HttpsError) {
            res.status(403).json({ error: err.message });
        }
        else {
            res.status(500).json({ error: 'Internal server error' });
        }
    }
});
/* =====================================================
   PROJECT FILE DELETE (CALLABLE)
===================================================== */
exports.deleteProjectFile = (0, https_1.onCall)({ region: 'europe-west2' }, async (req) => {
    assertAuthenticated(req.auth?.uid);
    const uid = req.auth.uid;
    const { projectId, fileId } = req.data ?? {};
    if (!projectId || !fileId) {
        throw new https_1.HttpsError('invalid-argument', 'projectId and fileId required');
    }
    const userSnap = await db.collection('users').doc(uid).get();
    const role = userSnap.data()?.role;
    const fileRef = db
        .collection('projects')
        .doc(projectId)
        .collection('files')
        .doc(fileId);
    const fileDoc = await fileRef.get();
    if (!fileDoc.exists)
        return { success: true };
    const data = fileDoc.data();
    if (uid !== data.uploaderId &&
        !['admin', 'owner', 'manager'].includes(role)) {
        throw new https_1.HttpsError('permission-denied', 'Not allowed');
    }
    if (data.fullPath) {
        await admin.storage().bucket().file(data.fullPath).delete().catch(() => { });
    }
    await fileRef.delete();
    return { success: true };
});
/* =====================================================
   ZIP PROJECT FILES
===================================================== */
exports.zipProjectFiles = (0, https_1.onCall)({ region: 'europe-west2', timeoutSeconds: 300, memory: '1GiB' }, async (req) => {
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
        throw new https_1.HttpsError('not-found', 'No files');
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
   SHIFTS
===================================================== */
exports.deleteAllShifts = (0, https_1.onCall)({ region: 'europe-west2' }, async (req) => {
    await assertIsOwner(req.auth?.uid);
    const snap = await db.collection('shifts').get();
    if (snap.empty)
        return { success: true };
    const batch = db.batch();
    snap.docs.forEach((d) => {
        const status = d.data().status;
        if (!['completed', 'incomplete', 'rejected'].includes(status)) {
            batch.delete(d.ref);
        }
    });
    await batch.commit();
    return { success: true };
});
/* =====================================================
   RE-GEOCODE SHIFTS
===================================================== */
exports.reGeocodeAllShifts = (0, https_1.onCall)({ region: 'europe-west2', timeoutSeconds: 540, memory: '1GiB' }, async (req) => {
    await assertIsOwner(req.auth?.uid);
    if (!GEOCODING_KEY) {
        throw new https_1.HttpsError('failed-precondition', 'Missing GOOGLE_GEOCODING_KEY');
    }
    const snap = await db.collection('shifts').get();
    let updated = 0;
    for (const doc of snap.docs) {
        const addr = doc.data().address;
        if (!addr)
            continue;
        const url = `https://maps.googleapis.com/maps/api/geocode/json` +
            `?address=${encodeURIComponent(addr + ', UK')}` +
            `&key=${GEOCODING_KEY}`;
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
   FIRESTORE TRIGGERS
===================================================== */
const europeWest2 = "europe-west2";
exports.onShiftCreated = (0, firestore_1.onDocumentCreated)({ document: "shifts/{shiftId}", region: europeWest2 }, async (event) => {
    const shift = event.data?.data();
    if (!shift)
        return;
    const userId = shift.userId;
    if (!userId) {
        v2_1.logger.log("Shift created without userId; no notify", {
            shiftId: event.params.shiftId,
        });
        return;
    }
    const shiftDate = shift.date?.toDate ? shift.date.toDate() : null;
    if (!shiftDate)
        return;
    if (isShiftInPast(shiftDate)) {
        v2_1.logger.log("Shift created in past; no notify", {
            shiftId: event.params.shiftId,
        });
        return;
    }
    const shiftId = event.params.shiftId;
    await sendShiftNotification(userId, "New shift added", `A new shift was added for ${formatDateUK(shiftDate)}`, pendingGateUrl(), { shiftId, gate: "pending", event: "created" });
});
exports.onShiftUpdated = (0, firestore_1.onDocumentUpdated)({ document: "shifts/{shiftId}", region: europeWest2 }, async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after)
        return;
    const shiftId = event.params.shiftId;
    const assignedBefore = before.userId ?? null;
    const assignedAfter = after.userId ?? null;
    const updatedByUid = after.updatedByUid ?? null;
    const beforeDate = before.date?.toDate?.() ?? null;
    const afterDate = after.date?.toDate?.() ?? null;
    // No assigned user => nothing to notify
    if (!assignedAfter)
        return;
    // Past shifts => never notify
    if (afterDate && isShiftInPast(afterDate))
        return;
    /* =====================================================
       SCENARIO 1 — REASSIGNMENT
    ===================================================== */
    if (assignedBefore !== assignedAfter) {
        v2_1.logger.log("Shift reassigned", { shiftId, from: assignedBefore, to: assignedAfter });
        if (assignedBefore && beforeDate && !isShiftInPast(beforeDate)) {
            await sendShiftNotification(assignedBefore, "Shift removed", `Your shift for ${formatDateUK(beforeDate)} has been removed.`, "/dashboard", { shiftId, event: "unassigned" });
        }
        if (assignedAfter && afterDate && !isShiftInPast(afterDate)) {
            await sendShiftNotification(assignedAfter, "New shift added", `A new shift was added for ${formatDateUK(afterDate)}`, pendingGateUrl(), { shiftId, event: "assigned", gate: "pending" });
        }
        return;
    }
    /* =====================================================
       CHANGE DETECTION (KEY FIX)
       - Work out what actually changed
       - Ignore audit/view fields that should never trigger notifications
    ===================================================== */
    // Fields that are allowed to change WITHOUT notifying anyone
    // Add any “re-open/view” fields your UI writes here.
    const IGNORE_FIELDS = new Set([
        "updatedByUid",
        "updatedAt",
        "lastUpdatedAt",
        "lastOpenedAt",
        "lastViewedAt",
        "viewedAt",
        "openedAt",
        "clientVersion",
    ]);
    // Fields that *do* count as meaningful shift changes
    const MEANINGFUL_FIELDS = new Set([
        "task",
        "address",
        "type",
        "notes",
        "status",
        "date",
        "userId",
    ]);
    const changedKeys = new Set();
    // Compare scalar-ish fields present in either object
    const allKeys = new Set([
        ...Object.keys(before),
        ...Object.keys(after),
    ]);
    for (const key of allKeys) {
        if (key === "date") {
            const sameDate = before.date?.isEqual?.(after.date) ??
                (before.date === after.date);
            if (!sameDate)
                changedKeys.add("date");
            continue;
        }
        const b = before[key];
        const a = after[key];
        // Shallow compare is fine for your use-case; nested objects are not meaningful here.
        if ((b ?? null) !== (a ?? null))
            changedKeys.add(key);
    }
    // Remove ignored fields from consideration
    const meaningfulChangedKeys = [...changedKeys].filter((k) => !IGNORE_FIELDS.has(k));
    // If nothing meaningful changed (e.g. user "re-opened" and UI wrote viewedAt) => NEVER notify
    if (meaningfulChangedKeys.length === 0) {
        v2_1.logger.log("No meaningful change; suppressing notification", { shiftId, changedKeys: [...changedKeys] });
        return;
    }
    // If the ONLY meaningful change is status => NEVER notify (covers incomplete/reopen patterns)
    const onlyStatusMeaningful = meaningfulChangedKeys.length === 1 && meaningfulChangedKeys[0] === "status";
    if (onlyStatusMeaningful) {
        v2_1.logger.log("Status-only change; suppressing notification", {
            shiftId,
            statusBefore: before.status,
            statusAfter: after.status,
            changedKeys: [...changedKeys],
        });
        return;
    }
    /* =====================================================
       SCENARIO 2 — SELF UPDATE (ABSOLUTE SILENCE)
       If updatedByUid is reliable, this hard-stops self updates.
       (Even if meaningful fields changed.)
    ===================================================== */
    if (updatedByUid && updatedByUid === assignedAfter) {
        v2_1.logger.log("Self-update detected; suppressing notification", {
            shiftId,
            userId: assignedAfter,
            changed: meaningfulChangedKeys,
        });
        return;
    }
    /* =====================================================
       SCENARIO 3 — ADMIN/MANAGER UPDATE (NOTIFY)
       We reach here only if:
       - meaningful changes happened
       - it wasn't status-only
       - it wasn't reliably detected as a self-update
    ===================================================== */
    if (!afterDate)
        return;
    const needsAction = String(after.status || "").toLowerCase() === "pending-confirmation";
    v2_1.logger.log("Meaningful non-self update; sending notification", {
        shiftId,
        userId: assignedAfter,
        updatedByUid,
        changed: meaningfulChangedKeys,
    });
    await sendShiftNotification(assignedAfter, "Shift updated", `Your shift for ${formatDateUK(afterDate)} has been updated.`, needsAction ? pendingGateUrl() : `/shift/${shiftId}`, {
        shiftId,
        event: "updated",
        changed: meaningfulChangedKeys,
        ...(needsAction ? { gate: "pending" } : {}),
    });
});
exports.onShiftDeleted = (0, firestore_1.onDocumentDeleted)({ document: "shifts/{shiftId}", region: europeWest2 }, async (event) => {
    const deleted = event.data?.data();
    if (!deleted)
        return;
    const userId = deleted.userId;
    if (!userId)
        return;
    const d = deleted.date?.toDate ? deleted.date.toDate() : null;
    const status = String(deleted.status || "").toLowerCase();
    const FINAL_STATUSES = new Set(["completed", "incomplete", "rejected"]);
    if (FINAL_STATUSES.has(status)) {
        v2_1.logger.log("Shift deleted but was historical; no notify", {
            shiftId: event.params.shiftId,
            status,
        });
        return;
    }
    if (d && isShiftInPast(d)) {
        v2_1.logger.log("Shift deleted but in past; no notify", {
            shiftId: event.params.shiftId,
        });
        return;
    }
    if (!d) {
        v2_1.logger.log("Shift deleted but no date; skipping notify", {
            shiftId: event.params.shiftId,
        });
        return;
    }
    await sendShiftNotification(userId, "Shift removed", `Your shift for ${formatDateUK(d)} has been removed.`, "/dashboard", { shiftId: event.params.shiftId, event: "deleted" });
});
exports.geocodeShiftOnCreate = (0, firestore_1.onDocumentCreated)("shifts/{shiftId}", async (event) => {
    const snap = event.data;
    if (!snap)
        return;
    const data = snap.data();
    // Must have a full address
    if (!data?.address)
        return;
    // Do not overwrite existing coordinates
    if (data?.location?.lat && data?.location?.lng)
        return;
    if (!GEOCODING_KEY) {
        console.error("Missing Geocoding API key");
        return;
    }
    const address = encodeURIComponent(`${data.address}, UK`);
    const url = `https://maps.googleapis.com/maps/api/geocode/json?` +
        `address=${address}&key=${GEOCODING_KEY}`;
    const res = await fetch(url);
    const json = (await res.json());
    if (json.status !== "OK" || !json.results?.length) {
        console.warn("Geocoding failed", data.address, json.status);
        return;
    }
    const result = json.results[0];
    const { lat, lng } = result.geometry.location;
    const accuracy = result.geometry.location_type;
    await snap.ref.update({
        location: {
            lat,
            lng,
            accuracy, // ROOFTOP | RANGE_INTERPOLATED | POSTAL_CODE
        },
    });
});
/* =====================================================
   SCHEDULED FUNCTIONS
===================================================== */
exports.projectReviewNotifier = (0, scheduler_1.onSchedule)({ schedule: "every 24 hours", region: europeWest2 }, () => {
    v2_1.logger.log("projectReviewNotifier executed.");
});
exports.pendingShiftNotifier = (0, scheduler_1.onSchedule)({ schedule: "every 1 hours", region: europeWest2 }, () => {
    v2_1.logger.log("pendingShiftNotifier executed.");
});
exports.getVapidPublicKey = (0, https_1.onCall)({ region: "europe-west2" }, () => {
    if (!WEBPUSH_PUBLIC_KEY) {
        v2_1.logger.error("WEBPUSH_PUBLIC_KEY is not set in environment variables.");
        throw new functions.https.HttpsError("failed-precondition", "VAPID public key is not configured on the server.");
    }
    return { publicKey: WEBPUSH_PUBLIC_KEY };
});
//# sourceMappingURL=index.js.map