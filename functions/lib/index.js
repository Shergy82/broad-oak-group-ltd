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
exports.getNotificationStatus = exports.onShiftWrite = exports.sendTestNotificationHttp = exports.setNotificationStatus = exports.getVapidPublicKey = void 0;
const admin = __importStar(require("firebase-admin"));
const logger = __importStar(require("firebase-functions/logger"));
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-functions/v2/firestore");
const webPush = __importStar(require("web-push"));
const crypto = __importStar(require("crypto"));
if (admin.apps.length === 0)
    admin.initializeApp();
const db = admin.firestore();
// ENV ONLY (Cloud Functions v2)
const VAPID_PUBLIC = process.env.WEBPUSH_PUBLIC_KEY || "";
const VAPID_PRIVATE = process.env.WEBPUSH_PRIVATE_KEY || "";
const VAPID_SUBJECT = process.env.WEBPUSH_SUBJECT || "mailto:example@your-project.com";
if (VAPID_PUBLIC && VAPID_PRIVATE) {
    webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}
else {
    logger.warn("VAPID keys not configured. Push notifications will not work.");
}
/**
 * Firestore doc IDs must NOT contain '/'.
 * Use base64url so the ID is always safe.
 */
function subIdFromEndpoint(endpoint) {
    return Buffer.from(endpoint)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
}
async function sendWebPushToUser(uid, payloadObj) {
    if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
        logger.error("VAPID not configured");
        return { sent: 0, removed: 0 };
    }
    const snap = await db.collection(`users/${uid}/pushSubscriptions`).get();
    if (snap.empty) {
        logger.info("No push subs for user", { uid });
        return { sent: 0, removed: 0 };
    }
    const payload = JSON.stringify(payloadObj);
    let sent = 0;
    let removed = 0;
    for (const docSnap of snap.docs) {
        const data = docSnap.data();
        // Support both shapes:
        // - { endpoint, keys }
        // - { subscription: { endpoint, keys } }
        const sub = data?.subscription && data?.subscription?.endpoint
            ? data.subscription
            : {
                endpoint: data.endpoint,
                keys: data.keys,
            };
        if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
            logger.warn("Invalid subscription doc; deleting", { uid, id: docSnap.id });
            await docSnap.ref.delete();
            removed++;
            continue;
        }
        try {
            await webPush.sendNotification(sub, payload);
            sent++;
        }
        catch (err) {
            const code = err?.statusCode;
            if (code === 404 || code === 410) {
                await docSnap.ref.delete();
                removed++;
            }
            else {
                logger.error("Push failed", err);
            }
        }
    }
    return { sent, removed };
}
function londonMidnightUtcMs(now = new Date()) {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/London",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(now);
    const y = Number(parts.find((p) => p.type === "year")?.value);
    const m = Number(parts.find((p) => p.type === "month")?.value);
    const d = Number(parts.find((p) => p.type === "day")?.value);
    const utcMidnight = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
    const hm = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/London",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    }).formatToParts(utcMidnight);
    const hh = Number(hm.find((p) => p.type === "hour")?.value || "0");
    const mm = Number(hm.find((p) => p.type === "minute")?.value || "0");
    return utcMidnight.getTime() - (hh * 60 + mm) * 60 * 1000;
}
function toMillis(v) {
    if (!v)
        return null;
    // Firestore Timestamp
    if (typeof v === "object" && typeof v.toMillis === "function")
        return v.toMillis();
    // number: ms or seconds
    if (typeof v === "number")
        return v > 1e12 ? v : v * 1000;
    // string date
    if (typeof v === "string") {
        const ms = Date.parse(v);
        return Number.isNaN(ms) ? null : ms;
    }
    // { seconds, nanoseconds }
    if (typeof v === "object" && typeof v.seconds === "number") {
        return v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6);
    }
    return null;
}
function getShiftStartMs(shift) {
    // Your schema:
    // - shift.date = Firestore Timestamp for the day (midnight)
    // - shift.type = "am" | "pm"
    const dayMs = toMillis(shift.date);
    if (dayMs !== null) {
        const t = (shift.type || "").toString().toLowerCase();
        const hour = t === "pm" ? 12 : 6;
        return dayMs + hour * 60 * 60 * 1000;
    }
    // Fallbacks (older schemas)
    const candidates = [
        shift.startAt,
        shift.start,
        shift.startsAt,
        shift.shiftStart,
        shift.startTime,
        shift.startDate,
        shift.date,
        shift.shiftDate,
        shift.day,
    ];
    for (const c of candidates) {
        const ms = toMillis(c);
        if (ms !== null)
            return ms;
    }
    return null;
}
function getShiftEndMs(shift) {
    const candidates = [
        shift.endAt,
        shift.end,
        shift.endsAt,
        shift.shiftEnd,
        shift.endTime,
        shift.endDate,
    ];
    for (const c of candidates) {
        const ms = toMillis(c);
        if (ms !== null)
            return ms;
    }
    return null;
}
function isCompletedShift(shift) {
    const status = (shift.status || shift.state || "").toString().toLowerCase();
    if (status === "completed" || status === "complete" || status === "done")
        return true;
    if (shift.completed === true)
        return true;
    if (shift.isCompleted === true)
        return true;
    if (shift.complete === true)
        return true;
    return false;
}
function stableStringify(obj) {
    if (obj === null || obj === undefined)
        return "";
    if (Array.isArray(obj))
        return "[" + obj.map(stableStringify).join(",") + "]";
    if (typeof obj !== "object")
        return JSON.stringify(obj);
    const keys = Object.keys(obj).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}
function relevantShiftSignature(shift) {
    // Only fields that should trigger a notification when changed.
    // Intentionally excludes status / confirmations / bookkeeping.
    const startMs = getShiftStartMs(shift);
    const endMs = getShiftEndMs(shift);
    const sig = {
        userId: shift.userId || shift.uid || null,
        startMs,
        endMs,
        addressId: shift.addressId ?? null,
        address: shift.address ?? null,
        site: shift.site ?? null,
        role: shift.role ?? null,
        job: shift.job ?? null,
        notes: shift.notes ?? shift.note ?? null,
        period: shift.period ?? shift.ampm ?? null,
    };
    return stableStringify(sig);
}
function hashSig(sig) {
    return crypto.createHash("sha256").update(sig).digest("hex");
}
exports.getVapidPublicKey = (0, https_1.onCall)({ region: "europe-west2" }, async () => {
    if (!VAPID_PUBLIC) {
        throw new https_1.HttpsError("failed-precondition", "VAPID public key is not configured");
    }
    return { publicKey: VAPID_PUBLIC };
});
exports.setNotificationStatus = (0, https_1.onCall)({ region: "europe-west2" }, async (req) => {
    if (!req.auth)
        throw new https_1.HttpsError("unauthenticated", "Login required");
    const uid = req.auth.uid;
    const data = req.data;
    const status = data?.status;
    const subscription = data?.subscription;
    const endpoint = data?.endpoint;
    const subs = db.collection("users").doc(uid).collection("pushSubscriptions");
    if (status === "subscribed") {
        if (!subscription?.endpoint)
            throw new https_1.HttpsError("invalid-argument", "Bad subscription");
        const id = typeof data?.subId === "string" && data.subId.trim()
            ? data.subId.trim()
            : subIdFromEndpoint(subscription.endpoint);
        await subs.doc(id).set({
            endpoint: subscription.endpoint,
            keys: subscription.keys,
            subscription, // keep full copy (helps compatibility)
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        return { ok: true };
    }
    if (status === "unsubscribed") {
        if (!endpoint)
            throw new https_1.HttpsError("invalid-argument", "Missing endpoint");
        const id = typeof data?.subId === "string" && data.subId.trim()
            ? data.subId.trim()
            : subIdFromEndpoint(endpoint);
        await subs.doc(id).delete();
        return { ok: true };
    }
    throw new https_1.HttpsError("invalid-argument", "Invalid status");
});
// ✅ FIXED: enable CORS so browser can read response (prevents “failed” UI)
exports.sendTestNotificationHttp = (0, https_1.onRequest)({ region: "europe-west2", cors: true }, async (req, res) => {
    try {
        res.setHeader("Cache-Control", "no-store");
        const uid = String(req.query.uid || "");
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
    }
    catch (e) {
        res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
});
/**
 * Fires on create/update/delete.
 * - Create: before missing, after present
 * - Update: before present, after present
 * - Delete: before present, after missing
 */
exports.onShiftWrite = (0, firestore_1.onDocumentWritten)({ region: "europe-west2", document: "shifts/{shiftId}" }, async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    const todayStartUtc = londonMidnightUtcMs(new Date()) - 5 * 60 * 1000;
    // Use after if present, else before for deletes
    const doc = after || before;
    if (!doc)
        return;
    // Must have a start date/time to be considered
    const startMs = getShiftStartMs(doc);
    if (startMs === null) {
        logger.info("Skip notification (no shift start date/time found)");
        return;
    }
    // Only notify for today + future
    if (startMs < todayStartUtc) {
        logger.info("Skip notification (past shift)", { startMs, todayStartUtc });
        return;
    }
    // Never notify for completed shifts
    if (isCompletedShift(doc)) {
        logger.info("Skip notification for completed shift");
        return;
    }
    // DELETE: cancellation
    if (before && !after) {
        const userId = before.userId || before.uid;
        if (!userId)
            return;
        const result = await sendWebPushToUser(userId, {
            title: "Shift Cancelled",
            body: "A shift you were assigned to has been cancelled.",
            url: "/dashboard",
        });
        logger.info("Shift delete push done", { userId, ...result });
        return;
    }
    // CREATE / UPDATE
    if (after) {
        const userId = after.userId || after.uid;
        if (!userId)
            return;
        const isCreate = !before && !!after;
        const isUpdate = !!before && !!after;
        // Dedupe: ignore updates where only bookkeeping changed
        if (isUpdate) {
            const beforeSig = relevantShiftSignature(before);
            const afterSig = relevantShiftSignature(after);
            if (beforeSig === afterSig) {
                logger.info("Skip notification (no meaningful shift changes)");
                return;
            }
            const beforeHash = hashSig(beforeSig);
            const afterHash = hashSig(afterSig);
            if (beforeHash === afterHash) {
                logger.info("Skip notification (identical shift hash)");
                return;
            }
        }
        const result = await sendWebPushToUser(userId, {
            title: isCreate ? "New Shift Assigned" : "Shift Updated",
            body: isCreate
                ? "You have been assigned a new shift."
                : "One of your shifts has been updated.",
            url: "/dashboard",
        });
        logger.info("Shift write push done", {
            userId,
            kind: isCreate ? "create" : isUpdate ? "update" : "write",
            ...result,
        });
    }
});
exports.getNotificationStatus = (0, https_1.onCall)({ region: "europe-west2" }, async (req) => {
    if (!req.auth)
        throw new https_1.HttpsError("unauthenticated", "Login required");
    const uid = req.auth.uid;
    const snap = await db
        .collection("users")
        .doc(uid)
        .collection("pushSubscriptions")
        .limit(1)
        .get();
    return { subscribed: !snap.empty };
});
//# sourceMappingURL=index.js.map