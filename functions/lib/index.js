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
        .replace(/[^a-z0-9]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
};
/* =====================================================
   SHIFT RECONCILIATION (SYNC ENGINE)
===================================================== */
exports.reconcileShifts = (0, https_1.onCall)({ region: REGION, timeoutSeconds: 300, memory: "1GiB" }, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) {
        throw new https_1.HttpsError("unauthenticated", "Authentication required");
    }
    await assertAdminOrManager(uid);
    const data = req.data;
    const { toCreate = [], toUpdate = [], toDelete = [], department } = data;
    if (!Array.isArray(toCreate) || !Array.isArray(toUpdate) || !Array.isArray(toDelete) || !department) {
        throw new https_1.HttpsError("invalid-argument", "Invalid payload. Expected toCreate array and department.");
    }
    const shiftsRef = db.collection("shifts");
    const projectsRef = db.collection("projects");
    const batch = db.batch();
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const toDate = (value) => {
        if (!value) {
            throw new https_1.HttpsError("invalid-argument", "Invalid date: empty value");
        }
        if (value instanceof Date) {
            if (Number.isNaN(value.getTime())) {
                throw new https_1.HttpsError("invalid-argument", "Invalid date: bad Date object");
            }
            return value;
        }
        if (typeof value?.toDate === "function") {
            const d = value.toDate();
            if (Number.isNaN(d.getTime())) {
                throw new https_1.HttpsError("invalid-argument", "Invalid date: bad Firestore Timestamp");
            }
            return d;
        }
        if (typeof value === "object" && typeof value.seconds === "number") {
            return new Date(value.seconds * 1000);
        }
        if (typeof value === "object" && typeof value._seconds === "number") {
            return new Date(value._seconds * 1000);
        }
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) {
            throw new https_1.HttpsError("invalid-argument", `Invalid date: ${JSON.stringify(value)}`);
        }
        return d;
    };
    const dayKey = (value) => {
        const d = toDate(value);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    const shiftKey = (shift) => {
        const userId = shift.userId || shift.operativeUid || "";
        return [
            department,
            userId,
            dayKey(shift.date),
            shift.type || "all-day",
        ].join("|");
    };
    const hasChanged = (existing, incoming) => {
        return ((existing.userId || "") !== incoming.operativeUid ||
            (existing.userName || "") !== incoming.operative ||
            (existing.operativeUid || "") !== incoming.operativeUid ||
            (existing.operative || "") !== incoming.operative ||
            (existing.address || "") !== (incoming.address || "") ||
            (existing.task || "") !== (incoming.task || "") ||
            (existing.type || "all-day") !== (incoming.type || "all-day") ||
            (existing.eNumber || "") !== (incoming.eNumber || "") ||
            (existing.contract || "") !== (incoming.contract || "") ||
            (existing.manager || "") !== (incoming.manager || "") ||
            (existing.sourceCell || "") !== (incoming.sourceCell || "") ||
            (existing.sourceSheet || "") !== (incoming.sourceSheet || "") ||
            (existing.descriptionOfWorks || "") !== (incoming.descriptionOfWorks || ""));
    };
    const futureImportedShiftsSnap = await shiftsRef
        .where("department", "==", department)
        .where("source", "==", "import")
        .get();
    const existingByKey = new Map();
    futureImportedShiftsSnap.docs.forEach((doc) => {
        const existing = doc.data();
        const existingDate = existing.date?.toDate?.();
        if (!existingDate || existingDate < todayStart)
            return;
        existingByKey.set(shiftKey(existing), doc);
    });
    const importedFutureShifts = [...toCreate, ...toUpdate.map((u) => u.new)].filter((shift) => {
        if (!shift.operativeUid) {
            throw new https_1.HttpsError("invalid-argument", `Missing operativeUid for ${shift.operative || "unknown operative"} at ${shift.address || "unknown address"}.`);
        }
        return toDate(shift.date) >= todayStart;
    });
    const importedKeys = new Set();
    let createdCount = 0;
    let updatedCount = 0;
    let deletedCount = 0;
    let unchangedCount = 0;
    // Project sync
    const allProjectsSnap = await projectsRef.where("department", "==", department).get();
    const existingProjects = new Set();
    allProjectsSnap.forEach((doc) => {
        existingProjects.add(normalizeText(doc.data().address));
    });
    for (const shift of importedFutureShifts) {
        const projectKey = normalizeText(shift.address);
        if (projectKey && !existingProjects.has(projectKey)) {
            const reviewDate = new Date();
            reviewDate.setDate(reviewDate.getDate() + 28);
            batch.set(projectsRef.doc(), {
                address: shift.address,
                eNumber: shift.eNumber || "",
                manager: shift.manager || "",
                contract: shift.contract || "",
                department,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                creatorId: uid,
                nextReviewDate: admin.firestore.Timestamp.fromDate(reviewDate),
            });
            existingProjects.add(projectKey);
        }
    }
    // Create or update
    for (const shift of importedFutureShifts) {
        const key = shiftKey(shift);
        importedKeys.add(key);
        const existingDoc = existingByKey.get(key);
        const payload = {
            userId: shift.operativeUid,
            userName: shift.operative,
            operativeUid: shift.operativeUid,
            operative: shift.operative,
            address: shift.address,
            task: shift.task,
            date: admin.firestore.Timestamp.fromDate(toDate(shift.date)),
            type: shift.type || "all-day",
            eNumber: shift.eNumber || "",
            contract: shift.contract || "",
            manager: shift.manager || "",
            department,
            status: "pending-confirmation",
            source: "import",
            plannerName: shift.plannerName || "",
            profileId: shift.plannerName || "",
            sourceCell: shift.sourceCell || "",
            sourceSheet: shift.sourceSheet || "",
            descriptionOfWorks: shift.descriptionOfWorks || "",
            importKey: key,
        };
        if (!existingDoc) {
            batch.set(shiftsRef.doc(), {
                ...payload,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            createdCount++;
        }
        else if (hasChanged(existingDoc.data(), shift)) {
            batch.update(existingDoc.ref, {
                ...payload,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            updatedCount++;
        }
        else {
            unchangedCount++;
        }
    }
    // Delete future imported shifts missing from latest import
    for (const shift of toDelete) {
        if (!shift.id)
            continue;
        batch.delete(shiftsRef.doc(shift.id));
        deletedCount++;
    }
    await batch.commit();
    return {
        success: true,
        message: `Schedule Sync Complete: ${createdCount} created, ${updatedCount} updated, ${deletedCount} deleted, ${unchangedCount} unchanged.`,
        createdCount,
        updatedCount,
        deletedCount,
        unchangedCount,
    };
});
/* =====================================================
   OTHER FUNCTIONS (SERVE FILE, USER MGMT, ETC)
===================================================== */
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
        const [metadata] = await file.getMetadata();
        res.setHeader("Content-Type", metadata.contentType || "application/octet-stream");
        res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(metadata.name || "download")}"`);
        file.createReadStream().pipe(res);
    }
    catch (error) {
        v2_1.logger.error("serveFile failed", error);
        res.status(500).send("Error serving file");
    }
});
exports.deleteUser = (0, https_1.onCall)({ region: REGION }, async (req) => {
    const data = req.data;
    if (!req.auth?.uid) {
        throw new https_1.HttpsError("unauthenticated", "Auth required");
    }
    await admin.auth().deleteUser(data.uid);
    await db.collection("users").doc(data.uid).delete();
    return { success: true };
});
exports.setUserStatus = (0, https_1.onCall)({ region: REGION }, async (req) => {
    const data = req.data;
    await admin.auth().updateUser(data.uid, { disabled: data.disabled });
    await db.collection("users").doc(data.uid).update({
        status: data.newStatus,
        department: data.department || "",
    });
    return { success: true };
});
exports.getVapidPublicKey = (0, https_1.onCall)({ region: REGION }, () => {
    return { publicKey: process.env.WEBPUSH_PUBLIC_KEY || "" };
});
//# sourceMappingURL=index.js.map