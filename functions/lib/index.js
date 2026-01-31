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
exports.getNotificationStatus = exports.onShiftWrite = exports.sendTestNotification = exports.setNotificationStatus = exports.getVapidPublicKey = void 0;
const admin = __importStar(require("firebase-admin"));
const logger = __importStar(require("firebase-functions/logger"));
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-functions/v2/firestore");
const webPush = __importStar(require("web-push"));
if (admin.apps.length === 0)
    admin.initializeApp();
const db = admin.firestore();
const VAPID_PUBLIC = process.env.WEBPUSH_PUBLIC_KEY || "";
const VAPID_PRIVATE = process.env.WEBPUSH_PRIVATE_KEY || "";
const VAPID_SUBJECT = process.env.WEBPUSH_SUBJECT || "mailto:example@your-project.com";
if (VAPID_PUBLIC && VAPID_PRIVATE) {
    webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}
else {
    logger.warn("VAPID keys not configured. Push notifications will not work.");
}
function subIdFromEndpoint(endpoint) {
    return Buffer.from(endpoint).toString("base64").replace(/=+$/g, "");
}
exports.getVapidPublicKey = (0, https_1.onCall)({ region: "europe-west2" }, async () => {
    if (!VAPID_PUBLIC) {
        throw new https_1.HttpsError("failed-precondition", "VAPID public key is not configured on the server.");
    }
    return { publicKey: VAPID_PUBLIC };
});
exports.setNotificationStatus = (0, https_1.onCall)({ region: "europe-west2" }, async (req) => {
    if (!req.auth)
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated.");
    const uid = req.auth.uid;
    const data = req.data;
    const status = data?.status;
    const subscription = data?.subscription;
    const endpoint = data?.endpoint;
    const subsCollection = db.collection("users").doc(uid).collection("pushSubscriptions");
    if (status === "subscribed") {
        if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
            throw new https_1.HttpsError("invalid-argument", "A valid subscription object is required.");
        }
        const id = subIdFromEndpoint(subscription.endpoint);
        await subsCollection.doc(id).set({
            endpoint: subscription.endpoint,
            keys: {
                p256dh: subscription.keys.p256dh,
                auth: subscription.keys.auth
            },
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        return { ok: true };
    }
    if (status === "unsubscribed") {
        if (!endpoint)
            throw new https_1.HttpsError("invalid-argument", "An endpoint is required to unsubscribe.");
        const id = subIdFromEndpoint(endpoint);
        await subsCollection.doc(id).delete();
        return { ok: true };
    }
    throw new https_1.HttpsError("invalid-argument", "Invalid status provided.");
});
exports.sendTestNotification = (0, https_1.onCall)({ region: "europe-west2" }, async (req) => {
    if (!req.auth)
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated.");
    if (!VAPID_PUBLIC || !VAPID_PRIVATE)
        throw new https_1.HttpsError("failed-precondition", "VAPID keys not configured.");
    const uid = req.auth.uid;
    const snap = await db.collection(`users/${uid}/pushSubscriptions`).get();
    if (snap.empty)
        return { ok: true, sent: 0, removed: 0 };
    const payload = JSON.stringify({
        title: "Test Notification",
        body: "If you received this, your push notifications are working!",
        url: "/push-debug"
    });
    let sent = 0;
    let removed = 0;
    await Promise.all(snap.docs.map(async (doc) => {
        const sub = doc.data();
        try {
            await webPush.sendNotification(sub, payload);
            sent++;
        }
        catch (err) {
            const code = err?.statusCode;
            if (code === 404 || code === 410) {
                await doc.ref.delete();
                removed++;
            }
            else {
                logger.error("Push send failed", err);
            }
        }
    }));
    return { ok: true, sent, removed };
});
// TEMP placeholder to keep file compiling if older onShiftWrite existed.
// Remove once push is stable.
exports.onShiftWrite = (0, firestore_1.onDocumentWritten)({ region: "europe-west2", document: "shifts/{shiftId}" }, async () => undefined);
exports.getNotificationStatus = (0, https_1.onCall)({ region: "europe-west2" }, async (req) => {
    if (!req.auth)
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated.");
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