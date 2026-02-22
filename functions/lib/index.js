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
exports.deleteScheduledProjects = exports.pendingShiftNotifier = exports.projectReviewNotifier = exports.onShiftCreated = exports.serveFile = exports.setNotificationStatus = exports.getNotificationStatus = void 0;
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-functions/v2/firestore");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const v2_1 = require("firebase-functions/v2");
const webPush = __importStar(require("web-push"));
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
   ENV
===================================================== */
const WEBPUSH_PUBLIC_KEY = process.env.WEBPUSH_PUBLIC_KEY ?? "";
const WEBPUSH_PRIVATE_KEY = process.env.WEBPUSH_PRIVATE_KEY ?? "";
const GEOCODING_KEY = process.env.GOOGLE_GEOCODING_KEY ?? "";
/* =====================================================
   VAPID CONFIG
===================================================== */
if (WEBPUSH_PUBLIC_KEY && WEBPUSH_PRIVATE_KEY) {
    try {
        webPush.setVapidDetails("mailto:example@yourdomain.org", WEBPUSH_PUBLIC_KEY, WEBPUSH_PRIVATE_KEY);
    }
    catch (err) {
        v2_1.logger.error("Failed to configure VAPID", err);
    }
}
else {
    v2_1.logger.warn("VAPID keys missing – push notifications disabled");
}
/* =====================================================
   HELPERS
===================================================== */
const assertAuthenticated = (uid) => {
    if (!uid)
        throw new https_1.HttpsError("unauthenticated", "Authentication required");
};
const assertIsOwner = async (uid) => {
    assertAuthenticated(uid);
    const snap = await db.collection("users").doc(uid).get();
    if (snap.data()?.role !== "owner") {
        throw new https_1.HttpsError("permission-denied", "Owner role required");
    }
};
const assertAdminOrManager = async (uid) => {
    const snap = await db.collection("users").doc(uid).get();
    if (!["admin", "owner", "manager"].includes(snap.data()?.role)) {
        throw new https_1.HttpsError("permission-denied", "Insufficient permissions");
    }
};
const formatDateUK = (d) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
const isShiftInPast = (d) => {
    const now = new Date();
    const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const shiftUtc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    return shiftUtc < todayUtc;
};
const pendingGateUrl = () => "/dashboard?gate=pending";
/* =====================================================
   NOTIFICATIONS
===================================================== */
async function sendShiftNotification(userId, title, body, url, data = {}) {
    if (!userId || !WEBPUSH_PUBLIC_KEY || !WEBPUSH_PRIVATE_KEY)
        return;
    const userDoc = await db.collection("users").doc(userId).get();
    if (userDoc.data()?.notificationsEnabled === false)
        return;
    const subs = await db
        .collection("users")
        .doc(userId)
        .collection("pushSubscriptions")
        .get();
    if (subs.empty)
        return;
    const payload = JSON.stringify({
        title,
        body,
        data: { url, ...data },
    });
    await Promise.all(subs.docs.map(async (doc) => {
        try {
            await webPush.sendNotification(doc.data(), payload);
        }
        catch (err) {
            if ([404, 410].includes(err?.statusCode)) {
                await doc.ref.delete().catch(() => { });
            }
        }
    }));
}
/* =====================================================
   CALLABLE FUNCTIONS
===================================================== */
exports.getNotificationStatus = (0, https_1.onCall)({ region: REGION }, async (req) => {
    assertAuthenticated(req.auth?.uid);
    const snap = await db.collection("users").doc(req.auth.uid).get();
    return { enabled: snap.data()?.notificationsEnabled ?? false };
});
exports.setNotificationStatus = (0, https_1.onCall)({ region: REGION }, async (req) => {
    assertAuthenticated(req.auth?.uid);
    const { enabled, subscription } = req.data ?? {};
    if (typeof enabled !== "boolean") {
        throw new https_1.HttpsError("invalid-argument", "enabled must be boolean");
    }
    await db
        .collection("users")
        .doc(req.auth.uid)
        .set({ notificationsEnabled: enabled }, { merge: true });
    if (enabled && subscription) {
        await db
            .collection("users")
            .doc(req.auth.uid)
            .collection("pushSubscriptions")
            .doc("browser")
            .set(subscription, { merge: true });
    }
    return { success: true };
});
/* =====================================================
   HTTP FILE SERVE
===================================================== */
exports.serveFile = (0, https_1.onRequest)({ region: REGION, cors: true }, async (req, res) => {
    const path = req.query.path;
    if (!path) {
        res.status(400).send("Missing path");
        return;
    }
    const file = admin.storage().bucket().file(path);
    const [exists] = await file.exists();
    if (!exists) {
        res.status(404).send("Not found");
        return;
    }
    file.createReadStream().pipe(res);
});
/* =====================================================
   FIRESTORE TRIGGERS
===================================================== */
exports.onShiftCreated = (0, firestore_1.onDocumentCreated)({ document: "shifts/{shiftId}", region: REGION }, async (event) => {
    const shift = event.data?.data();
    if (!shift?.userId)
        return;
    const date = shift.date?.toDate?.();
    if (!date || isShiftInPast(date))
        return;
    await sendShiftNotification(shift.userId, "New shift added", `A new shift was added for ${formatDateUK(date)}`, pendingGateUrl(), { shiftId: event.params.shiftId });
});
/* =====================================================
   SCHEDULED FUNCTIONS (FIXED)
===================================================== */
exports.projectReviewNotifier = (0, scheduler_1.onSchedule)({ schedule: "every 24 hours", region: REGION }, async (event) => {
    v2_1.logger.info("projectReviewNotifier ran", {
        scheduleTime: event.scheduleTime,
    });
});
exports.pendingShiftNotifier = (0, scheduler_1.onSchedule)({ schedule: "every 1 hours", region: REGION }, async (event) => {
    v2_1.logger.info("pendingShiftNotifier ran", {
        scheduleTime: event.scheduleTime,
    });
});
exports.deleteScheduledProjects = (0, scheduler_1.onSchedule)({
    schedule: "every day 01:00",
    region: REGION,
    timeoutSeconds: 540,
    memory: "256MiB",
}, async (event) => {
    v2_1.logger.info("Scheduled project cleanup started", {
        scheduleTime: event.scheduleTime,
    });
    // TODO: deletion logic here
    v2_1.logger.info("Scheduled project cleanup finished");
});
//# sourceMappingURL=index.js.map