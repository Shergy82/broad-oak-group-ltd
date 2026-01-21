"use strict";
/**
 * Firebase Functions (Gen 2)
 */
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
exports.sendShiftNotification = exports.getVapidPublicKey = void 0;
const v2_1 = require("firebase-functions/v2");
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-functions/v2/firestore");
const params_1 = require("firebase-functions/params");
const admin = __importStar(require("firebase-admin"));
(0, v2_1.setGlobalOptions)({ maxInstances: 10, region: "europe-west2" });
admin.initializeApp();
const VAPID_PUBLIC_KEY = (0, params_1.defineSecret)("VAPID_PUBLIC_KEY");
/**
 * Callable: returns the VAPID public key (used by web push subscription)
 */
exports.getVapidPublicKey = (0, https_1.onCall)({ region: "europe-west2", secrets: [VAPID_PUBLIC_KEY] }, async () => {
    try {
        const raw = await VAPID_PUBLIC_KEY.value();
        // Normalize URL-safe base64 to standard base64 for decoding
        const base64 = raw.replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
        const padding = "=".repeat((4 - (base64.length % 4)) % 4);
        const normalized = base64 + padding;
        const buf = Buffer.from(normalized, "base64");
        const length = buf.length;
        const firstByte = buf.length > 0 ? buf[0] : null;
        console.info("getVapidPublicKey: decoded key length=" +
            length +
            ", firstByte=0x" +
            (firstByte !== null ? firstByte.toString(16) : "null"));
        return { publicKey: raw };
    }
    catch (err) {
        console.error("Error reading VAPID public key secret:", err);
        throw err;
    }
});
/**
 * Firestore Trigger: sends a push notification when a shift is created/updated.
 *
 * Expects:
 * - shifts stored at: shifts/{shiftId}
 * - shift doc contains one of: userId OR assignedToUid OR workerId (uid of the worker)
 * - tokens stored at: users/{uid}/pushSubscriptions/{doc}
 *   where token is in field "fcmToken" or "token", or doc ID is the token
 */
exports.sendShiftNotification = (0, firestore_1.onDocumentWritten)({ document: "shifts/{shiftId}", region: "europe-west2" }, async (event) => {
    var _a, _b, _c, _d;
    const after = (_b = (_a = event.data) === null || _a === void 0 ? void 0 : _a.after) === null || _b === void 0 ? void 0 : _b.data();
    const before = (_d = (_c = event.data) === null || _c === void 0 ? void 0 : _c.before) === null || _d === void 0 ? void 0 : _d.data();
    // Ignore deletes
    if (!after)
        return;
    const shiftId = event.params.shiftId;
    // Only notify on create or meaningful updates
    const isCreate = !before;
    const meaningfulChange = !before ||
        after.status !== before.status ||
        after.startTime !== before.startTime ||
        after.endTime !== before.endTime ||
        after.address !== before.address;
    if (!isCreate && !meaningfulChange) {
        console.info("sendShiftNotification: no meaningful change, skipping", { shiftId });
        return;
    }
    // Determine target user
    const uid = after.userId ||
        after.assignedToUid ||
        after.workerId;
    if (!uid) {
        console.warn("sendShiftNotification: missing uid field on shift", { shiftId });
        return;
    }
    // Get tokens
    const subsSnap = await admin
        .firestore()
        .collection("users")
        .doc(uid)
        .collection("pushSubscriptions")
        .get();
    const tokens = [];
    subsSnap.forEach((doc) => {
        const d = doc.data();
        const token = d.fcmToken || d.token || doc.id;
        if (token)
            tokens.push(token);
    });
    if (tokens.length === 0) {
        console.info("sendShiftNotification: no tokens for user", { uid, shiftId });
        return;
    }
    // Build a payload that displays on iPhone PWA + desktop
    const title = isCreate ? "New shift assigned" : "Shift updated";
    const body = "Tap to view your shift details.";
    const link = "https://broad-oak-group-ltd--the-final-project-5e248.europe-west4.hosted.app/shifts";
    // IMPORTANT: Do NOT type this as MulticastMessage (it requires tokens).
    // We build a "message without token/topic/condition" and add tokens at send time.
    const baseMessage = {
        notification: { title, body },
        webpush: {
            headers: { Urgency: "high" },
            notification: {
                title,
                body,
                icon: "/icons/icon-192.png",
                badge: "/icons/icon-192.png",
                data: { url: "/shifts" },
            },
            fcmOptions: { link },
        },
        data: {
            type: isCreate ? "shift_created" : "shift_updated",
            shiftId,
        },
    };
    const res = await admin.messaging().sendEachForMulticast(Object.assign(Object.assign({}, baseMessage), { tokens }));
    const successCount = res.responses.filter((r) => r.success).length;
    console.info("sendShiftNotification: push attempted", {
        uid,
        shiftId,
        tokenCount: tokens.length,
        successCount,
    });
    // Optional: remove dead tokens (only works if doc.id == token)
    const dead = [];
    res.responses.forEach((r, i) => {
        var _a, _b;
        if (!r.success) {
            const code = ((_a = r.error) === null || _a === void 0 ? void 0 : _a.code) || "";
            console.warn("sendShiftNotification: push failed", {
                uid,
                shiftId,
                token: tokens[i],
                code,
                message: (_b = r.error) === null || _b === void 0 ? void 0 : _b.message,
            });
            if (code.includes("registration-token-not-registered") ||
                code.includes("invalid-argument")) {
                dead.push(tokens[i]);
            }
        }
    });
    if (dead.length) {
        const batch = admin.firestore().batch();
        for (const t of dead) {
            batch.delete(admin.firestore().collection("users").doc(uid).collection("pushSubscriptions").doc(t));
        }
        await batch.commit().catch(() => { });
        console.warn("sendShiftNotification: cleaned dead tokens", {
            uid,
            deadCount: dead.length,
        });
    }
});
//# sourceMappingURL=index.js.map