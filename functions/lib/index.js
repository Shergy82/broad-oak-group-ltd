"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pendingShiftNotifier = exports.projectReviewNotifier = exports.setNotificationStatus = exports.getNotificationStatus = exports.onShiftDeleted = exports.onShiftUpdated = exports.onShiftCreated = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-functions/v2/firestore");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const v2_1 = require("firebase-functions/v2");
const params_1 = require("firebase-functions/params");
const firebase_admin_1 = __importDefault(require("firebase-admin"));
// --- Admin init ---
if (!firebase_admin_1.default.apps.length)
    firebase_admin_1.default.initializeApp();
const db = firebase_admin_1.default.firestore();
// --- Config / secrets ---
const APP_BASE_URL = (0, params_1.defineString)("APP_BASE_URL");
// Optional global kill switch doc: settings/notifications { enabled: true/false }
const europeWest2 = "europe-west2";
/**
 * Firestore path where we store FCM tokens:
 * users/{uid}/pushTokens/{tokenDocId}
 * { token: string, updatedAt: string, userAgent?: string }
 */
async function getUserFcmTokens(userId) {
    const snap = await db
        .collection("users")
        .doc(userId)
        .collection("pushTokens")
        .get();
    if (snap.empty)
        return [];
    const tokens = [];
    for (const doc of snap.docs) {
        const data = doc.data();
        const t = (data.token || data.fcmToken || doc.id || "")
            .toString()
            .trim();
        if (t)
            tokens.push(t);
    }
    return Array.from(new Set(tokens));
}
async function pruneInvalidTokens(userId, invalidTokens) {
    if (!invalidTokens.length)
        return;
    const col = db.collection("users").doc(userId).collection("pushTokens");
    const snap = await col.get();
    const batch = db.batch();
    for (const d of snap.docs) {
        const data = d.data();
        const t = (data.token || data.fcmToken || d.id || "").toString().trim();
        if (invalidTokens.includes(t))
            batch.delete(d.ref);
    }
    await batch.commit();
    v2_1.logger.log("Pruned invalid tokens", { userId, count: invalidTokens.length });
}
function formatDateUK(d) {
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const yyyy = String(d.getUTCFullYear());
    return `${dd}/${mm}/${yyyy}`;
}
/**
 * Returns true if the shift is on a day strictly before "today".
 * We compare by UTC day to avoid timezone drift and libraries.
 */
function isShiftInPast(shiftDate) {
    const now = new Date();
    const startOfTodayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const shiftDayUtc = new Date(Date.UTC(shiftDate.getUTCFullYear(), shiftDate.getUTCMonth(), shiftDate.getUTCDate()));
    return shiftDayUtc < startOfTodayUtc;
}
function absoluteLink(pathOrUrl) {
    const base = (APP_BASE_URL.value() || "").trim().replace(/\/+$/, "");
    if (!base)
        return pathOrUrl; // fallback
    if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://"))
        return pathOrUrl;
    const path = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
    return `${base}${path}`;
}
async function sendFcmToUser(userId, title, body, urlPath, data = {}) {
    var _a;
    if (!userId)
        return;
    // global kill switch
    const settingsDoc = await db.collection("settings").doc("notifications").get();
    if (settingsDoc.exists && ((_a = settingsDoc.data()) === null || _a === void 0 ? void 0 : _a.enabled) === false) {
        v2_1.logger.log("Global notifications disabled; skipping send", { userId });
        return;
    }
    const tokens = await getUserFcmTokens(userId);
    if (!tokens.length) {
        v2_1.logger.warn("No FCM tokens for user; cannot send", { userId });
        return;
    }
    const link = absoluteLink(urlPath);
    const message = {
        tokens,
        notification: { title, body },
        data: Object.assign({ url: link }, Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]))),
        webpush: {
            fcmOptions: { link },
            notification: {
                icon: "/icons/icon-192x192.png",
            },
        },
    };
    const resp = await firebase_admin_1.default.messaging().sendEachForMulticast(message);
    const invalid = [];
    resp.responses.forEach((r, idx) => {
        var _a, _b;
        if (!r.success) {
            const code = ((_a = r.error) === null || _a === void 0 ? void 0 : _a.code) || "";
            if (code.includes("registration-token-not-registered") ||
                code.includes("invalid-argument") ||
                code.includes("invalid-registration-token")) {
                invalid.push(tokens[idx]);
            }
            v2_1.logger.error("FCM send failed", {
                userId,
                code,
                msg: (_b = r.error) === null || _b === void 0 ? void 0 : _b.message,
            });
        }
    });
    if (invalid.length)
        await pruneInvalidTokens(userId, invalid);
    v2_1.logger.log("FCM send complete", {
        userId,
        tokens: tokens.length,
        success: resp.successCount,
        failure: resp.failureCount,
    });
}
// ✅ CHANGED: central place to send users when action is required
function pendingGateUrl() {
    return "/dashboard?gate=pending";
}
// --- Firestore triggers: shifts/{shiftId} ---
exports.onShiftCreated = (0, firestore_1.onDocumentCreated)({ document: "shifts/{shiftId}", region: europeWest2 }, async (event) => {
    var _a, _b, _c;
    const shift = (_a = event.data) === null || _a === void 0 ? void 0 : _a.data();
    if (!shift)
        return;
    const userId = shift.userId;
    if (!userId) {
        v2_1.logger.log("Shift created without userId; no notify", {
            shiftId: event.params.shiftId,
        });
        return;
    }
    const shiftDate = ((_c = (_b = shift.date) === null || _b === void 0 ? void 0 : _b.toDate) === null || _c === void 0 ? void 0 : _c.call(_b)) ? shift.date.toDate() : null;
    if (!shiftDate)
        return;
    if (isShiftInPast(shiftDate)) {
        v2_1.logger.log("Shift created in past; no notify", {
            shiftId: event.params.shiftId,
        });
        return;
    }
    const shiftId = event.params.shiftId;
    await sendFcmToUser(userId, "New shift added", `A new shift was added for ${formatDateUK(shiftDate)}`, pendingGateUrl(), // ✅ CHANGED (was /shift/{id})
    {
        shiftId, // ✅ include shiftId for the app to highlight / open modal
        gate: "pending", // ✅ allow UI to force the pending screen
        event: "created",
    });
});
exports.onShiftUpdated = (0, firestore_1.onDocumentUpdated)({ document: "shifts/{shiftId}", region: europeWest2 }, async (event) => {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const before = (_a = event.data) === null || _a === void 0 ? void 0 : _a.before.data();
    const after = (_b = event.data) === null || _b === void 0 ? void 0 : _b.after.data();
    if (!before || !after)
        return;
    const shiftId = event.params.shiftId;
    // 1) reassignment
    if (before.userId !== after.userId) {
        if (before.userId) {
            const d = ((_d = (_c = before.date) === null || _c === void 0 ? void 0 : _c.toDate) === null || _d === void 0 ? void 0 : _d.call(_c)) ? before.date.toDate() : null;
            await sendFcmToUser(before.userId, "Shift unassigned", d
                ? `Your shift for ${formatDateUK(d)} has been removed.`
                : "A shift has been removed.", "/dashboard", { shiftId, event: "unassigned" });
        }
        if (after.userId) {
            const d = ((_f = (_e = after.date) === null || _e === void 0 ? void 0 : _e.toDate) === null || _f === void 0 ? void 0 : _f.call(_e)) ? after.date.toDate() : null;
            if (d && !isShiftInPast(d)) {
                await sendFcmToUser(after.userId, "New shift added", `A new shift was added for ${formatDateUK(d)}`, pendingGateUrl(), // ✅ CHANGED (was /shift/{id})
                { shiftId, gate: "pending", event: "assigned" });
            }
        }
        v2_1.logger.log("Shift reassigned", {
            shiftId,
            from: before.userId,
            to: after.userId,
        });
        return;
    }
    // 2) meaningful change for same user
    const userId = after.userId;
    if (!userId)
        return;
    const afterDate = ((_h = (_g = after.date) === null || _g === void 0 ? void 0 : _g.toDate) === null || _h === void 0 ? void 0 : _h.call(_g)) ? after.date.toDate() : null;
    if (!afterDate)
        return;
    if (isShiftInPast(afterDate)) {
        v2_1.logger.log("Shift updated but in past; no notify", { shiftId });
        return;
    }
    const fieldsToCompare = [
        "task",
        "address",
        "type",
        "notes",
        "status",
        "date",
    ];
    const changed = fieldsToCompare.some((field) => {
        var _a, _b;
        if (field === "date") {
            const b = before.date;
            const a = after.date;
            if ((b === null || b === void 0 ? void 0 : b.isEqual) && a)
                return !b.isEqual(a);
            return String(b) !== String(a);
        }
        return ((_a = before[field]) !== null && _a !== void 0 ? _a : null) !== ((_b = after[field]) !== null && _b !== void 0 ? _b : null);
    });
    if (!changed) {
        v2_1.logger.log("Shift updated but no meaningful change", { shiftId });
        return;
    }
    // ✅ CHANGED: if it's pending-confirmation (or becomes pending), force the gate
    const needsAction = String(after.status || "").toLowerCase() === "pending-confirmation";
    await sendFcmToUser(userId, "Shift updated", `Your shift for ${formatDateUK(afterDate)} has been updated.`, needsAction ? pendingGateUrl() : `/shift/${shiftId}`, Object.assign({ shiftId, event: "updated" }, (needsAction ? { gate: "pending" } : {})));
});
exports.onShiftDeleted = (0, firestore_1.onDocumentDeleted)({ document: "shifts/{shiftId}", region: europeWest2 }, async (event) => {
    var _a, _b, _c;
    const deleted = (_a = event.data) === null || _a === void 0 ? void 0 : _a.data();
    if (!deleted)
        return;
    const userId = deleted.userId;
    if (!userId)
        return;
    const d = ((_c = (_b = deleted.date) === null || _b === void 0 ? void 0 : _b.toDate) === null || _c === void 0 ? void 0 : _c.call(_b)) ? deleted.date.toDate() : null;
    await sendFcmToUser(userId, "Shift removed", d
        ? `Your shift for ${formatDateUK(d)} has been removed.`
        : "A shift has been removed.", "/dashboard", { shiftId: event.params.shiftId, event: "deleted" });
});
// --- Optional callables (safe) ---
exports.getNotificationStatus = (0, https_1.onCall)({ region: europeWest2 }, async () => {
    var _a;
    const doc = await db.collection("settings").doc("notifications").get();
    const enabled = doc.exists ? ((_a = doc.data()) === null || _a === void 0 ? void 0 : _a.enabled) !== false : true;
    return { enabled };
});
exports.setNotificationStatus = (0, https_1.onCall)({ region: europeWest2 }, async (req) => {
    var _a;
    // IMPORTANT: you should lock this down by auth/role. Stub for now.
    const enabled = !!((_a = req.data) === null || _a === void 0 ? void 0 : _a.enabled);
    await db
        .collection("settings")
        .doc("notifications")
        .set({ enabled }, { merge: true });
    return { success: true, enabled };
});
// schedulers kept
exports.projectReviewNotifier = (0, scheduler_1.onSchedule)({ schedule: "every 24 hours", region: europeWest2 }, () => {
    v2_1.logger.log("projectReviewNotifier executed.");
});
exports.pendingShiftNotifier = (0, scheduler_1.onSchedule)({ schedule: "every 1 hours", region: europeWest2 }, () => {
    v2_1.logger.log("pendingShiftNotifier executed.");
});
//# sourceMappingURL=index.js.map