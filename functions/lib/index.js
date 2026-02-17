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
exports.reGeocodeAllShifts = exports.deleteAllShifts = exports.zipProjectFiles = exports.deleteProjectFile = exports.deleteProjectAndFiles = exports.deleteUser = exports.setUserStatus = exports.setNotificationStatus = exports.getNotificationStatus = void 0;
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
const jszip_1 = __importDefault(require("jszip"));
/* =====================================================
   Bootstrap
===================================================== */
if (admin.apps.length === 0) {
    admin.initializeApp();
}
const db = admin.firestore();
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
/* =====================================================
   NOTIFICATIONS
===================================================== */
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
        res.status(500).json({ error: 'Internal server error' });
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
        throw new https_1.HttpsError('failed-precondition', 'Missing GEOCODING_KEY');
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
//# sourceMappingURL=index.js.map