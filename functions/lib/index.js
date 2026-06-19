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
const v2_1 = require("firebase-functions/v2");
/* =====================================================
   BOOTSTRAP
===================================================== */
if (admin.apps.length === 0) {
    admin.initializeApp();
}
const db = admin.firestore();
const REGION = "europe-west2";
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
    const { toCreate = [], toUpdate = [], toDelete = [], department, profileId, profileName } = data;
    if (!department)
        throw new https_1.HttpsError('invalid-argument', 'Missing department.');
    if (!profileId)
        throw new https_1.HttpsError('invalid-argument', 'Missing planner identity.');
    const batch = db.batch();
    const shiftsRef = db.collection('shifts');
    const projectsRef = db.collection('projects');
    // 1. Sync Projects
    const allProjectsSnap = await projectsRef.where('department', '==', department).get();
    const existingProjects = new Map();
    allProjectsSnap.forEach(d => existingProjects.set(normalizeText(d.data().address), d.ref));
    const allImportedShifts = [...toCreate, ...toUpdate.map((u) => u.new)];
    const uniqueIncomingSites = new Map();
    allImportedShifts.forEach((s) => { if (s.address)
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
        const shiftPayload = {
            address: s.address || "",
            contract: s.contract || "",
            department: s.department || department || "",
            eNumber: s.eNumber || "",
            manager: s.manager || "",
            operative: s.operative || s.userName || "",
            operativeUid: s.operativeUid || s.userId || "",
            userId: s.userId || s.operativeUid || "",
            userName: s.userName || s.operative || "",
            date: s.date instanceof admin.firestore.Timestamp ? s.date : admin.firestore.Timestamp.fromDate(new Date(s.date)),
            dateKey: s.dateKey || "",
            type: s.type || "all-day",
            startTime: s.startTime || "",
            endTime: s.endTime || "",
            task: s.task || "",
            descriptionOfWorks: s.descriptionOfWorks || "",
            room: s.room || "",
            source: "import",
            sourcePlannerId: s.sourcePlannerId || profileId || "",
            sourcePlannerName: s.sourcePlannerName || profileName || "",
            plannerName: s.plannerName || profileName || "",
            profileId: s.profileId || profileId || "",
            importKey: s.importKey || "",
            sourceSheet: s.sourceSheet || "",
            sourceCell: s.sourceCell || "",
            status: s.status || 'pending-confirmation',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };
        v2_1.logger.info("SHIFT_IMPORT_WRITE_PAYLOAD (CREATE)", shiftPayload);
        batch.set(shiftsRef.doc(), shiftPayload);
    });
    // 3. Update & Backfill Shifts
    toUpdate.forEach(({ id, new: n }) => {
        const shiftUpdatePayload = {
            address: n.address || "",
            contract: n.contract || "",
            department: n.department || department || "",
            eNumber: n.eNumber || "",
            manager: n.manager || "",
            operative: n.operative || n.userName || "",
            operativeUid: n.operativeUid || n.userId || "",
            userId: n.userId || n.operativeUid || "",
            userName: n.userName || n.operative || "",
            date: n.date instanceof admin.firestore.Timestamp ? n.date : admin.firestore.Timestamp.fromDate(new Date(n.date)),
            dateKey: n.dateKey || "",
            type: n.type || "all-day",
            startTime: n.startTime || "",
            endTime: n.endTime || "",
            task: n.task || "",
            descriptionOfWorks: n.descriptionOfWorks || "",
            room: n.room || "",
            source: "import",
            sourcePlannerId: n.sourcePlannerId || profileId || "",
            sourcePlannerName: n.sourcePlannerName || profileName || "",
            plannerName: n.plannerName || profileName || "",
            profileId: n.profileId || profileId || "",
            importKey: n.importKey || "",
            sourceSheet: n.sourceSheet || "",
            sourceCell: n.sourceCell || "",
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };
        v2_1.logger.info("SHIFT_IMPORT_WRITE_PAYLOAD (UPDATE)", { id, ...shiftUpdatePayload });
        batch.update(shiftsRef.doc(id), shiftUpdatePayload);
    });
    // 4. Delete Shifts
    toDelete.forEach((s) => {
        if (s.id) {
            batch.delete(shiftsRef.doc(s.id));
        }
    });
    await batch.commit();
    return {
        success: true,
        message: `Schedule Sync Complete: ${toCreate.length} created, ${toUpdate.length} updated/backfilled, ${toDelete.length} removed.`
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
    const { uid, disabled, newStatus, department } = data;
    await admin.auth().updateUser(uid, { disabled: disabled });
    await db.collection('users').doc(uid).update({ status: newStatus, department: department || '' });
    return { success: true };
});
exports.getVapidPublicKey = (0, https_1.onCall)({ region: REGION }, () => {
    return { publicKey: process.env.WEBPUSH_PUBLIC_KEY || "" };
});
//# sourceMappingURL=index.js.map