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
exports.onShiftWrite = exports.zipProjectFiles = exports.deleteAllProjects = exports.deleteProjectAndFiles = exports.deleteProjectFile = exports.deleteAllShifts = exports.deleteUser = exports.setUserStatus = void 0;
// functions/src/index.ts
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-functions/v2/firestore");
const webPush = __importStar(require("web-push"));
const jszip_1 = __importDefault(require("jszip"));
const storage_1 = require("firebase-admin/storage");
/* =========================
   Init
========================= */
if (!admin.apps.length)
    admin.initializeApp();
const db = admin.firestore();
const storage = (0, storage_1.getStorage)();
/* =========================
   Shared config
========================= */
const HTTP_OPTS = {
    region: "europe-west2",
    cors: true,
};
/* =========================
   ENV
========================= */
const VAPID_PUBLIC = process.env.WEBPUSH_PUBLIC_KEY || "";
const VAPID_PRIVATE = process.env.WEBPUSH_PRIVATE_KEY || "";
const VAPID_SUBJECT = process.env.WEBPUSH_SUBJECT || "mailto:example@your-project.com";
if (VAPID_PUBLIC && VAPID_PRIVATE) {
    webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}
/* =========================
   Auth helper
========================= */
async function verifyAuth(req, res, roles) {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) {
        res.status(401).json({ error: "UNAUTHENTICATED" });
        return null;
    }
    try {
        const decoded = await admin.auth().verifyIdToken(token);
        if (roles?.length) {
            const snap = await db.collection("users").doc(decoded.uid).get();
            const role = snap.data()?.role;
            if (!roles.includes(role)) {
                res.status(403).json({ error: "PERMISSION_DENIED" });
                return null;
            }
        }
        return decoded;
    }
    catch {
        res.status(401).json({ error: "INVALID_TOKEN" });
        return null;
    }
}
/* =========================
   USERS
========================= */
exports.setUserStatus = (0, https_1.onRequest)(HTTP_OPTS, async (req, res) => {
    const auth = await verifyAuth(req, res, ["admin", "owner"]);
    if (!auth)
        return;
    const { uid, disabled, newStatus } = req.body.data || {};
    if (!uid || typeof disabled !== "boolean" || !newStatus) {
        res.status(400).json({ error: "BAD_REQUEST" });
        return;
    }
    await admin.auth().updateUser(uid, { disabled });
    await db.collection("users").doc(uid).update({ status: newStatus });
    res.json({
        data: {
            success: true,
            uid,
            status: newStatus,
        },
    });
});
exports.deleteUser = (0, https_1.onRequest)(HTTP_OPTS, async (req, res) => {
    const auth = await verifyAuth(req, res, ["admin", "owner"]);
    if (!auth)
        return;
    const { uid } = req.body.data || {};
    if (!uid) {
        res.status(400).json({ error: "BAD_REQUEST" });
        return;
    }
    await admin.auth().deleteUser(uid);
    await db.collection("users").doc(uid).delete();
    res.json({
        data: {
            success: true,
            uid,
        },
    });
});
/* =========================
   SHIFTS
========================= */
exports.deleteAllShifts = (0, https_1.onRequest)(HTTP_OPTS, async (req, res) => {
    const auth = await verifyAuth(req, res, ["owner"]);
    if (!auth)
        return;
    let deleted = 0;
    while (true) {
        const snap = await db.collection("shifts").limit(400).get();
        if (snap.empty)
            break;
        const batch = db.batch();
        snap.docs.forEach(d => {
            batch.delete(d.ref);
            deleted++;
        });
        await batch.commit();
    }
    res.json({
        data: {
            success: true,
            deleted,
        },
    });
});
/* =========================
   PROJECT FILES
========================= */
exports.deleteProjectFile = (0, https_1.onRequest)(HTTP_OPTS, async (req, res) => {
    const auth = await verifyAuth(req, res, ["owner", "admin", "manager"]);
    if (!auth)
        return;
    const { projectId, fileId } = req.body.data || {};
    if (!projectId || !fileId) {
        res.status(400).json({ error: "BAD_REQUEST" });
        return;
    }
    const ref = db
        .collection("projects")
        .doc(projectId)
        .collection("files")
        .doc(fileId);
    const snap = await ref.get();
    if (!snap.exists) {
        res.status(404).json({ error: "NOT_FOUND" });
        return;
    }
    const data = snap.data();
    if (data?.fullPath) {
        await storage.bucket().file(data.fullPath).delete().catch(() => { });
    }
    await ref.delete();
    res.json({
        data: {
            success: true,
            projectId,
            fileId,
        },
    });
});
exports.deleteProjectAndFiles = (0, https_1.onRequest)(HTTP_OPTS, async (req, res) => {
    const auth = await verifyAuth(req, res, ["owner", "admin", "manager"]);
    if (!auth)
        return;
    const { projectId } = req.body.data || {};
    if (!projectId) {
        res.status(400).json({ error: "BAD_REQUEST" });
        return;
    }
    await storage
        .bucket()
        .deleteFiles({ prefix: `project_files/${projectId}` })
        .catch(() => { });
    const files = await db
        .collection("projects")
        .doc(projectId)
        .collection("files")
        .get();
    const batch = db.batch();
    files.forEach(f => batch.delete(f.ref));
    await batch.commit();
    await db.collection("projects").doc(projectId).delete();
    res.json({
        data: {
            success: true,
            projectId,
        },
    });
});
exports.deleteAllProjects = (0, https_1.onRequest)(HTTP_OPTS, async (req, res) => {
    const auth = await verifyAuth(req, res, ["owner"]);
    if (!auth)
        return;
    let deleted = 0;
    const projects = await db.collection("projects").get();
    for (const p of projects.docs) {
        await storage
            .bucket()
            .deleteFiles({ prefix: `project_files/${p.id}` })
            .catch(() => { });
        const files = await p.ref.collection("files").get();
        const batch = db.batch();
        files.forEach(f => batch.delete(f.ref));
        await batch.commit();
        await p.ref.delete();
        deleted++;
    }
    res.json({
        data: {
            success: true,
            deleted,
        },
    });
});
exports.zipProjectFiles = (0, https_1.onRequest)({ ...HTTP_OPTS, timeoutSeconds: 300 }, async (req, res) => {
    const auth = await verifyAuth(req, res);
    if (!auth)
        return;
    const { projectId } = req.body.data || {};
    if (!projectId) {
        res.status(400).json({ error: "BAD_REQUEST" });
        return;
    }
    const files = await db
        .collection("projects")
        .doc(projectId)
        .collection("files")
        .get();
    const zip = new jszip_1.default();
    for (const f of files.docs) {
        const d = f.data();
        const [buf] = await storage.bucket().file(d.fullPath).download();
        zip.file(d.name, buf);
    }
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    const name = `zips/${projectId}-${Date.now()}.zip`;
    const file = storage.bucket().file(name);
    await file.save(buffer);
    const [url] = await file.getSignedUrl({
        action: "read",
        expires: Date.now() + 15 * 60 * 1000,
    });
    res.json({
        data: {
            success: true,
            downloadUrl: url,
        },
    });
});
/* =========================
   SHIFT PUSH
========================= */
exports.onShiftWrite = (0, firestore_1.onDocumentWritten)({ region: "europe-west2", document: "shifts/{shiftId}" }, async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    const shift = after || before;
    if (!shift)
        return;
    const userId = shift.userId || shift.uid;
    if (!userId)
        return;
    let title = "";
    let body = "";
    if (!before && after) {
        title = "New Shift Assigned";
        body = "You have been assigned a new shift.";
    }
    else if (before && !after) {
        title = "Shift Cancelled";
        body = "A shift has been cancelled.";
    }
    else if (before && after) {
        title = "Shift Updated";
        body = "One of your shifts has been updated.";
    }
    else {
        return;
    }
    const subsSnap = await db
        .collection("users")
        .doc(userId)
        .collection("pushSubscriptions")
        .get();
    if (subsSnap.empty)
        return;
    const payload = JSON.stringify({
        title,
        body,
        url: "/dashboard",
    });
    for (const doc of subsSnap.docs) {
        try {
            await webPush.sendNotification(doc.data().subscription, payload);
        }
        catch (e) {
            if (e?.statusCode === 404 || e?.statusCode === 410) {
                await doc.ref.delete();
            }
        }
    }
});
//# sourceMappingURL=index.js.map