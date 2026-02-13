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
Object.defineProperty(exports, "__esModule", { value: true });
exports.serveFile = exports.cleanupDeletedProjects = exports.onShiftWrite = exports.sendTestNotificationHttp = exports.setNotificationStatus = exports.getVapidPublicKey = void 0;
const admin = __importStar(require("firebase-admin"));
const logger = __importStar(require("firebase-functions/logger"));
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-functions/v2/firestore");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const webPush = __importStar(require("web-push"));
const crypto = __importStar(require("crypto"));
/* =========================================================
 *  Bootstrap
 * ========================================================= */
if (admin.apps.length === 0) {
    admin.initializeApp();
}
const db = admin.firestore();
/* =========================================================
 *  Environment (Functions v2)
 * ========================================================= */
const VAPID_PUBLIC = process.env.WEBPUSH_PUBLIC_KEY ?? "";
const VAPID_PRIVATE = process.env.WEBPUSH_PRIVATE_KEY ?? "";
const VAPID_SUBJECT = process.env.WEBPUSH_SUBJECT ?? "mailto:example@your-project.com";
if (VAPID_PUBLIC && VAPID_PRIVATE) {
    webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}
else {
    logger.warn("VAPID keys not configured – push disabled");
}
/* =========================================================
 *  Helpers
 * ========================================================= */
function subIdFromEndpoint(endpoint) {
    return Buffer.from(endpoint)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
}
async function sendWebPushToUser(uid, payload) {
    if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
        return { sent: 0, removed: 0 };
    }
    const snap = await db
        .collection("users")
        .doc(uid)
        .collection("pushSubscriptions")
        .get();
    if (snap.empty)
        return { sent: 0, removed: 0 };
    let sent = 0;
    let removed = 0;
    const body = JSON.stringify(payload);
    for (const doc of snap.docs) {
        const data = doc.data();
        const sub = data?.subscription?.endpoint
            ? data.subscription
            : data?.endpoint && data?.keys
                ? { endpoint: data.endpoint, keys: data.keys }
                : null;
        if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
            await doc.ref.delete();
            removed++;
            continue;
        }
        try {
            await webPush.sendNotification(sub, body);
            sent++;
        }
        catch (e) {
            if (e?.statusCode === 404 || e?.statusCode === 410) {
                await doc.ref.delete();
                removed++;
            }
            else {
                logger.error("Push failed", e);
            }
        }
    }
    return { sent, removed };
}
function toMillis(v) {
    if (!v)
        return null;
    if (typeof v === "number")
        return v > 1e12 ? v : v * 1000;
    if (typeof v === "string") {
        const ms = Date.parse(v);
        return Number.isNaN(ms) ? null : ms;
    }
    if (typeof v?.toMillis === "function")
        return v.toMillis();
    if (typeof v?.seconds === "number") {
        return v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6);
    }
    return null;
}
function getShiftStartMs(shift) {
    const dayMs = toMillis(shift.date);
    if (dayMs !== null) {
        const hour = String(shift.type).toLowerCase() === "pm" ? 12 : 6;
        return dayMs + hour * 60 * 60 * 1000;
    }
    return toMillis(shift.startAt ??
        shift.start ??
        shift.startsAt ??
        shift.startTime ??
        shift.startDate);
}
function getShiftEndMs(shift) {
    return toMillis(shift.endAt ??
        shift.end ??
        shift.endsAt ??
        shift.endTime ??
        shift.endDate);
}
function isCompletedShift(shift) {
    const s = String(shift.status ?? "").toLowerCase();
    return (s === "completed" ||
        s === "complete" ||
        s === "done" ||
        shift.completed === true);
}
function stableStringify(obj) {
    if (obj === null || obj === undefined)
        return "";
    if (Array.isArray(obj))
        return `[${obj.map(stableStringify).join(",")}]`;
    if (typeof obj !== "object")
        return JSON.stringify(obj);
    return `{${Object.keys(obj)
        .sort()
        .map((k) => `"${k}":${stableStringify(obj[k])}`)
        .join(",")}}`;
}
function hashSig(sig) {
    return crypto.createHash("sha256").update(sig).digest("hex");
}
/* =========================================================
 *  Callable / HTTP
 * ========================================================= */
exports.getVapidPublicKey = (0, https_1.onCall)({ region: "europe-west2" }, async () => {
    if (!VAPID_PUBLIC) {
        throw new https_1.HttpsError("failed-precondition", "VAPID public key not configured");
    }
    return { publicKey: VAPID_PUBLIC };
});
exports.setNotificationStatus = (0, https_1.onCall)({ region: "europe-west2" }, async (req) => {
    if (!req.auth)
        throw new https_1.HttpsError("unauthenticated", "Login required");
    const { status, subscription, endpoint, subId } = req.data || {};
    const uid = req.auth.uid;
    const subs = db
        .collection("users")
        .doc(uid)
        .collection("pushSubscriptions");
    if (status === "subscribed") {
        if (!subscription?.endpoint) {
            throw new https_1.HttpsError("invalid-argument", "Invalid subscription");
        }
        const id = subId?.trim() || subIdFromEndpoint(subscription.endpoint);
        await subs.doc(id).set({
            endpoint: subscription.endpoint,
            keys: subscription.keys,
            subscription,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        return { ok: true };
    }
    if (status === "unsubscribed") {
        if (!endpoint) {
            throw new https_1.HttpsError("invalid-argument", "Missing endpoint");
        }
        const id = subId?.trim() || subIdFromEndpoint(endpoint);
        await subs.doc(id).delete();
        return { ok: true };
    }
    throw new https_1.HttpsError("invalid-argument", "Invalid status");
});
exports.sendTestNotificationHttp = (0, https_1.onRequest)({ region: "europe-west2", cors: true }, async (req, res) => {
    const uid = String(req.query.uid ?? "");
    if (!uid) {
        res.status(400).json({ ok: false, error: "Missing uid" });
        return;
    }
    const result = await sendWebPushToUser(uid, {
        title: "Test Notification",
        body: "Push is working",
        url: "/",
    });
    res.json({ ok: true, ...result });
});
/* =========================================================
 *  Firestore trigger
 * ========================================================= */
exports.onShiftWrite = (0, firestore_1.onDocumentWritten)({ region: "europe-west2", document: "shifts/{shiftId}" }, async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    const doc = after ?? before;
    if (!doc)
        return;
    const startMs = getShiftStartMs(doc);
    if (startMs === null || isCompletedShift(doc))
        return;
    const uid = doc.userId ?? doc.uid;
    if (!uid)
        return;
    await sendWebPushToUser(uid, {
        title: after && !before ? "New Shift Assigned" : "Shift Updated",
        body: "Your shift details have changed.",
        url: "/dashboard",
    });
});
/* =========================================================
 *  Scheduled cleanup (FIXED – v2 compliant)
 * ========================================================= */
exports.cleanupDeletedProjects = (0, scheduler_1.onSchedule)({
    schedule: "every 24 hours",
    region: "europe-west2",
    timeoutSeconds: 540,
    memory: "512MiB",
}, async (_event) => {
    logger.info("Running project cleanup");
    const cutoff = admin.firestore.Timestamp.fromDate(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
    const snap = await db
        .collection("projects")
        .where("deletionScheduledAt", "<=", cutoff)
        .get();
    if (snap.empty)
        return;
    const bucket = admin.storage().bucket();
    for (const doc of snap.docs) {
        const projectId = doc.id;
        await bucket.deleteFiles({
            prefix: `project_files/${projectId}/`,
            force: true,
        });
        const filesSnap = await doc.ref.collection("files").limit(500).get();
        if (!filesSnap.empty) {
            const batch = db.batch();
            filesSnap.docs.forEach((d) => batch.delete(d.ref));
            await batch.commit();
        }
        await doc.ref.delete();
        logger.info("Deleted project", { projectId });
    }
});
var files_1 = require("./files");
Object.defineProperty(exports, "serveFile", { enumerable: true, get: function () { return files_1.serveFile; } });
//# sourceMappingURL=index.js.map