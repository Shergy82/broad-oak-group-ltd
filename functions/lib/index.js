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
exports.onShiftWrite = exports.setNotificationStatus = void 0;
// functions/src/index.ts
const admin = __importStar(require("firebase-admin"));
const cors_1 = __importDefault(require("cors"));
const webPush = __importStar(require("web-push"));
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-functions/v2/firestore");
if (!admin.apps.length)
    admin.initializeApp();
const db = admin.firestore();
const europeWest2 = "europe-west2";
const corsHandler = (0, cors_1.default)({ origin: true });
// ----------------------------
// setNotificationStatus (HTTP)
// Auth: Authorization: Bearer <Firebase ID token>
// Body: { enabled: boolean, subscription?: { endpoint, keys } }
// ALSO accepts callable-style body: { data: { enabled, subscription } }
// Stores subs at: users/{uid}/pushSubscriptions/{urlSafeBase64(endpoint)}
// ----------------------------
exports.setNotificationStatus = (0, https_1.onRequest)({ region: europeWest2 }, (req, res) => {
    return corsHandler(req, res, async () => {
        if (req.method === "OPTIONS") {
            res.status(204).send("");
            return;
        }
        try {
            // ---- Auth ----
            const auth = req.get("Authorization") || "";
            const m = auth.match(/^Bearer\s+(.+)$/i);
            if (!m) {
                res.status(401).json({ data: null, error: "Missing Authorization: Bearer <token>" });
                return;
            }
            const decoded = await admin.auth().verifyIdToken(m[1]);
            const uid = decoded.uid;
            // ---- Body ----
            // Support BOTH:
            //   HTTP style:      { enabled, subscription }
            //   Callable style:  { data: { enabled, subscription } }
            const body = (req.body && typeof req.body === "object") ? req.body : {};
            const payload = (body.data && typeof body.data === "object") ? body.data : body;
            const enabledRaw = payload.enabled;
            if (typeof enabledRaw !== "boolean") {
                res.status(400).json({ data: null, error: "Body must include { enabled: boolean }" });
                return;
            }
            const enabled = enabledRaw;
            const subscription = payload.subscription;
            const subsRef = db.collection("users").doc(uid).collection("pushSubscriptions");
            if (enabled) {
                if (!subscription || !subscription.endpoint || !subscription.keys) {
                    res.status(400).json({ data: null, error: "Valid subscription is required." });
                    return;
                }
                // URL-safe doc id (avoids '/' '+' '=' issues in doc IDs)
                const docId = Buffer.from(String(subscription.endpoint))
                    .toString("base64")
                    .replace(/\+/g, "-")
                    .replace(/\//g, "_")
                    .replace(/=+$/g, "");
                await subsRef.doc(docId).set({
                    endpoint: subscription.endpoint,
                    keys: subscription.keys,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                }, { merge: true });
                // IMPORTANT: frontend expects { data: ... }
                res.json({ data: { success: true, enabled: true } });
                return;
            }
            // enabled === false -> delete all subs for user
            const snap = await subsRef.get();
            if (!snap.empty) {
                const batch = db.batch();
                snap.docs.forEach((d) => batch.delete(d.ref));
                await batch.commit();
            }
            res.json({ data: { success: true, enabled: false } });
        }
        catch (e) {
            res.status(400).json({ data: null, error: (e === null || e === void 0 ? void 0 : e.message) || "Unknown error" });
        }
    });
});
// ----------------------------
// onShiftWrite -> send Web Push
// Requires env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY
// ----------------------------
exports.onShiftWrite = (0, firestore_1.onDocumentWritten)({ document: "shifts/{shiftId}", region: europeWest2 }, async (event) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    const settingsDoc = await db.collection("settings").doc("notifications").get();
    if (settingsDoc.exists && ((_a = settingsDoc.data()) === null || _a === void 0 ? void 0 : _a.enabled) === false)
        return;
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    if (!publicKey || !privateKey) {
        console.error("Missing VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY");
        return;
    }
    webPush.setVapidDetails("mailto:notifications@broadoakgroup.com", publicKey, privateKey);
    const beforeData = (_b = event.data) === null || _b === void 0 ? void 0 : _b.before.data();
    const afterData = (_c = event.data) === null || _c === void 0 ? void 0 : _c.after.data();
    let userId = null;
    let payload = null;
    if (((_d = event.data) === null || _d === void 0 ? void 0 : _d.after.exists) && !((_e = event.data) === null || _e === void 0 ? void 0 : _e.before.exists)) {
        userId = (afterData === null || afterData === void 0 ? void 0 : afterData.userId) || null;
        payload = {
            title: "New Shift Assigned",
            body: `You have a new shift: ${afterData === null || afterData === void 0 ? void 0 : afterData.task} at ${afterData === null || afterData === void 0 ? void 0 : afterData.address}.`,
            data: { url: "/dashboard" },
        };
    }
    else if (!((_f = event.data) === null || _f === void 0 ? void 0 : _f.after.exists) && ((_g = event.data) === null || _g === void 0 ? void 0 : _g.before.exists)) {
        userId = (beforeData === null || beforeData === void 0 ? void 0 : beforeData.userId) || null;
        payload = {
            title: "Shift Cancelled",
            body: `Your shift for ${beforeData === null || beforeData === void 0 ? void 0 : beforeData.task} at ${beforeData === null || beforeData === void 0 ? void 0 : beforeData.address} has been cancelled.`,
            data: { url: "/dashboard" },
        };
    }
    else if (((_h = event.data) === null || _h === void 0 ? void 0 : _h.after.exists) && ((_j = event.data) === null || _j === void 0 ? void 0 : _j.before.exists)) {
        const changed = (beforeData === null || beforeData === void 0 ? void 0 : beforeData.task) !== (afterData === null || afterData === void 0 ? void 0 : afterData.task) ||
            (beforeData === null || beforeData === void 0 ? void 0 : beforeData.address) !== (afterData === null || afterData === void 0 ? void 0 : afterData.address) ||
            ((beforeData === null || beforeData === void 0 ? void 0 : beforeData.date) && (afterData === null || afterData === void 0 ? void 0 : afterData.date) && !beforeData.date.isEqual(afterData.date));
        if (changed) {
            userId = (afterData === null || afterData === void 0 ? void 0 : afterData.userId) || null;
            payload = {
                title: "Your Shift Has Been Updated",
                body: "The details for one of your shifts have changed.",
                data: { url: "/dashboard" },
            };
        }
    }
    if (!userId || !payload)
        return;
    const subsSnap = await db.collection("users").doc(userId).collection("pushSubscriptions").get();
    if (subsSnap.empty)
        return;
    await Promise.all(subsSnap.docs.map(async (d) => {
        const sub = d.data();
        try {
            await webPush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, JSON.stringify(payload));
        }
        catch (err) {
            const code = err === null || err === void 0 ? void 0 : err.statusCode;
            if (code === 404 || code === 410) {
                await d.ref.delete(); // prune dead subscription
            }
            else {
                console.error("web-push send failed:", err);
            }
        }
    }));
});
//# sourceMappingURL=index.js.map