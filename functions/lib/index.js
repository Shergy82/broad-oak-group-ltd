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
Object.defineProperty(exports, "__esModule", { value: true });
exports.getVapidPublicKey = exports.setUserStatus = exports.deleteUser = exports.serveFile = exports.reconcileShifts = void 0;
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
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
   HELPERS
===================================================== */
const assertAdminOrManager = async (uid) => {
    const snap = await db.collection("users").doc(uid).get();
    const role = snap.data()?.role;
    if (!["admin", "owner", "manager", "TLO"].includes(role)) {
        throw new https_1.HttpsError("permission-denied", "Insufficient permissions for this action.");
    }
};
const normalizeText = (text) => {
    if (!text)
        return "";
    return String(text)
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
};
/* =====================================================
   SHIFT RECONCILIATION (SYNC ENGINE)
===================================================== */
exports.reconcileShifts = (0, https_1.onCall)({ region: REGION, timeoutSeconds: 300, memory: '1GiB' }, async (req) => {
    const uid = req.auth?.uid;
    if (!uid)
        throw new https_1.HttpsError("unauthenticated", "Authentication required");
    await assertAdminOrManager(uid);
    const data = req.data;
    const { toCreate = [], toUpdate = [], toDelete = [], department, profileId } = data;
    if (!department)
        throw new https_1.HttpsError('invalid-argument', 'Missing department.');
    if (!profileId)
        throw new https_1.HttpsError('invalid-argument', 'Missing planner identity (profileId).');
    const batch = db.batch();
    const shiftsRef = db.collection('shifts');
    const projectsRef = db.collection('projects');
    // 1. Sync Projects
    const allProjectsSnap = await projectsRef.where('department', '==', department).get();
    const existingProjects = new Map();
    allProjectsSnap.forEach(d => existingProjects.set(normalizeText(d.data().address), d.ref));
    const allIncoming = [...toCreate, ...toUpdate.map((u) => u.new)];
    const uniqueIncomingSites = new Map();
    allIncoming.forEach((s) => { if (s.address)
        uniqueIncomingSites.set(normalizeText(s.address), s); });
    for (const [normAddr, info] of uniqueIncomingSites.entries()) {
        if (!existingProjects.has(normAddr)) {
            const reviewDate = new Date();
            reviewDate.setDate(reviewDate.getDate() + 28);
            batch.set(projectsRef.doc(), {
                address: info.address,
                eNumber: info.eNumber || '',
                manager: info.manager || '',
                contract: info.contract || '',
                department: department,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                creatorId: uid,
                nextReviewDate: admin.firestore.Timestamp.fromDate(reviewDate),
            });
        }
    }
    // 2. Create Shifts
    toCreate.forEach((s) => {
        if (!s.operativeUid)
            throw new https_1.HttpsError('invalid-argument', `Cannot create shift: operativeUid missing for ${s.operative}.`);
        batch.set(shiftsRef.doc(), {
            userId: s.operativeUid,
            userName: s.operative,
            address: s.address,
            task: s.task,
            date: admin.firestore.Timestamp.fromDate(new Date(s.date)),
            type: s.type || 'all-day',
            eNumber: s.eNumber || '',
            contract: s.contract || '',
            manager: s.manager || '',
            department: department,
            status: 'pending',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            source: 'import',
            sourcePlannerId: profileId,
            importKey: s.importKey
        });
    });
    // 3. Update Shifts
    toUpdate.forEach(({ id, new: n }) => {
        if (!n.operativeUid)
            throw new https_1.HttpsError('invalid-argument', `Cannot update shift ${id}: missing operativeUid.`);
        batch.update(shiftsRef.doc(id), {
            userId: n.operativeUid,
            userName: n.operative,
            address: n.address,
            task: n.task,
            date: admin.firestore.Timestamp.fromDate(new Date(n.date)),
            type: n.type || 'all-day',
            eNumber: n.eNumber || '',
            contract: n.contract || '',
            manager: n.manager || '',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            sourcePlannerId: profileId,
            importKey: n.importKey
        });
    });
    // 4. Delete Shifts (Strictly scoped to profileId)
    toDelete.forEach((s) => {
        if (s.id) {
            batch.delete(shiftsRef.doc(s.id));
        }
    });
    await batch.commit();
    return {
        success: true,
        message: `Schedule Sync Complete: ${toCreate.length} created, ${toUpdate.length} updated, ${toDelete.length} removed.`
    };
});
exports.serveFile = (0, https_1.onRequest)({ region: REGION, cors: true }, async (req, res) => {
    const path = req.query.path;
    if (!path) {
        res.status(400).send("Missing path");
        return;
    }
    try {
        const file = admin.storage().bucket().file(path);
        const [exists] = await file.exists();
        if (!exists) {
            res.status(404).send("Not found");
            return;
        }
        file.createReadStream().pipe(res);
    }
    catch (error) {
        res.status(500).send("Error serving file");
    }
});
exports.deleteUser = (0, https_1.onCall)({ region: REGION }, async (req) => {
    const data = req.data;
    if (!req.auth?.uid)
        throw new https_1.HttpsError("unauthenticated", "Auth required");
    await admin.auth().deleteUser(data.uid);
    await db.collection('users').doc(data.uid).delete();
    return { success: true };
});
exports.setUserStatus = (0, https_1.onCall)({ region: REGION }, async (req) => {
    const data = req.data;
    await admin.auth().updateUser(data.uid, { disabled: data.disabled });
    await db.collection('users').doc(data.uid).update({ status: data.newStatus, department: data.department || '' });
    return { success: true };
});
exports.getVapidPublicKey = (0, https_1.onCall)({ region: REGION }, () => {
    return { publicKey: process.env.WEBPUSH_PUBLIC_KEY || "" };
});
//# sourceMappingURL=index.js.map