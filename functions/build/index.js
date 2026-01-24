"use strict";
// functions/src/index.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pendingShiftNotifier = exports.projectReviewNotifier = exports.setNotificationStatus = exports.getNotificationStatus = exports.onShiftDeleted = exports.onShiftUpdated = exports.onShiftCreated = exports.bootstrapClaims = void 0;
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const v2_1 = require("firebase-functions/v2");
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-functions/v2/firestore");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const params_1 = require("firebase-functions/params");
// --- Admin init ---
if (!firebase_admin_1.default.apps.length)
    firebase_admin_1.default.initializeApp();
const db = firebase_admin_1.default.firestore();
// --- Config / params ---
const APP_BASE_URL = (0, params_1.defineString)("APP_BASE_URL");
const ADMIN_BOOTSTRAP_SECRET = (0, params_1.defineSecret)("ADMIN_BOOTSTRAP_SECRET");
const europeWest2 = "europe-west2";
// --------------------
// BOOTSTRAP (one-time) - sets custom claims owner/admin
// --------------------
exports.bootstrapClaims = (0, https_1.onRequest)({ secrets: [ADMIN_BOOTSTRAP_SECRET], region: europeWest2 }, async (req, res) => {
    try {
        if (req.method !== "POST") {
            res.status(405).send("Use POST");
            return;
        }
        const headerSecret = req.get("x-admin-secret") || "";
        const realSecret = ADMIN_BOOTSTRAP_SECRET.value();
        if (!realSecret || headerSecret !== realSecret) {
            res.status(401).send("Unauthorized");
            return;
        }
        const uid = String(req.query.uid || "").trim();
        if (!uid) {
            res.status(400).send("Missing uid");
            return;
        }
        await firebase_admin_1.default.auth().setCustomUserClaims(uid, {
            // booleans
            owner: true,
            admin: true,
            isOwner: true,
            isAdmin: true,
            // role-style claims
            role: "owner",
            roles: ["owner", "admin"],
            permissions: { owner: true, admin: true },
        });
        const after = await firebase_admin_1.default.auth().getUser(uid);
        const claims = after.customClaims || {};
        res.status(200).json({ ok: true, uid, claims });
        return;
    }
    catch (e) {
        res.status(500).send((e === null || e === void 0 ? void 0 : e.message) || String(e));
        return;
    }
});
// --------------------
// Helpers
// --------------------
/**
 * Firestore path where we store FCM tokens:
 * users/{uid}/pushTokens/{tokenDocId}
 * { token: string, updatedAt: Timestamp, userAgent?: string, platform?: string }
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
    for (const docSnap of snap.docs) {
        const data = docSnap.data();
        const t = (data.token || data.fcmToken || docSnap.id || "")
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
 * Compare by UTC day to avoid timezone drift.
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
    if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
        return pathOrUrl;
    }
    const path = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
    return `${base}${path}`;
}
// Central place to send users when action is required
function pendingGateUrl() {
    return "/dashboard?gate=pending";
}
/**
 * Check user-level preference switch.
 * If users/{uid}.notificationsEnabled === false => do not send.
 */
async function isUserNotificationsEnabled(userId) {
    var _a;
    const userDoc = await db.collection("users").doc(userId).get();
    if (!userDoc.exists)
        return true; // default allow
    const enabled = (_a = userDoc.data()) === null || _a === void 0 ? void 0 : _a.notificationsEnabled;
    return enabled !== false;
}
async function sendFcmToUser(userId, title, body, urlPath, data = {}) {
    var _a;
    if (!userId)
        return;
    // Global kill switch
    const settingsDoc = await db.collection("settings").doc("notifications").get();
    if (settingsDoc.exists && ((_a = settingsDoc.data()) === null || _a === void 0 ? void 0 : _a.enabled) === false) {
        v2_1.logger.log("Global notifications disabled; skipping send", { userId });
        return;
    }
    // User-level switch
    const userEnabled = await isUserNotificationsEnabled(userId);
    if (!userEnabled) {
        v2_1.logger.log("User notifications disabled; skipping send", { userId });
        return;
    }
    const tokens = await getUserFcmTokens(userId);
    if (!tokens.length) {
        v2_1.logger.info("No FCM tokens for user; cannot send", { userId });
        return;
    }
    const link = absoluteLink(urlPath);
    // DATA-ONLY payload (service worker handles notification display)
    const message = {
        tokens,
        data: Object.assign({ title,
            body, url: link }, Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]))),
        webpush: {
            headers: { Urgency: "high" },
            fcmOptions: { link },
        },
        apns: {
            payload: { aps: { sound: "default" } },
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
// --------------------
// Firestore triggers: shifts/{shiftId}
// --------------------
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
    // Only today/future
    if (isShiftInPast(shiftDate)) {
        v2_1.logger.log("Shift created in past; no notify", {
            shiftId: event.params.shiftId,
        });
        return;
    }
    const shiftId = event.params.shiftId;
    await sendFcmToUser(userId, "New shift added", `A new shift was added for ${formatDateUK(shiftDate)}`, pendingGateUrl(), { shiftId, gate: "pending", event: "created" });
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
                await sendFcmToUser(after.userId, "New shift added", `A new shift was added for ${formatDateUK(d)}`, pendingGateUrl(), { shiftId, gate: "pending", event: "assigned" });
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
    // Only today/future
    if (isShiftInPast(afterDate)) {
        v2_1.logger.log("Shift updated but in past; no notify", { shiftId });
        return;
    }
    // If the shift owner updated their OWN shift, do NOT notify them about their own action.
    const updatedByUid = String(after.updatedByUid || "").trim();
    if (updatedByUid && updatedByUid === String(userId)) {
        v2_1.logger.log("Shift updated by assigned user; skipping notify", {
            shiftId,
            userId,
            updatedByUid,
            updatedByAction: String(after.updatedByAction || ""),
            statusBefore: String(before.status || ""),
            statusAfter: String(after.status || ""),
        });
        return;
    }
    // Only notify when meaningful fields change
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
    const status = String(deleted.status || "").toLowerCase();
    const FINAL_STATUSES = new Set(["completed", "incomplete", "rejected"]);
    // Never notify for history/final shifts
    if (FINAL_STATUSES.has(status)) {
        v2_1.logger.log("Shift deleted but was historical; no notify", {
            shiftId: event.params.shiftId,
            status,
        });
        return;
    }
    // Never notify for past/expired shifts
    if (d && isShiftInPast(d)) {
        v2_1.logger.log("Shift deleted but in past; no notify", {
            shiftId: event.params.shiftId,
        });
        return;
    }
    // Fail-safe: if no date, skip notification
    if (!d) {
        v2_1.logger.log("Shift deleted but no date; skipping notify", {
            shiftId: event.params.shiftId,
        });
        return;
    }
    await sendFcmToUser(userId, "Shift removed", `Your shift for ${formatDateUK(d)} has been removed.`, "/dashboard", { shiftId: event.params.shiftId, event: "deleted" });
});
// --------------------
// Callables
// --------------------
exports.getNotificationStatus = (0, https_1.onCall)({ region: europeWest2 }, async (req) => {
    var _a, _b;
    const docSnap = await db.collection("settings").doc("notifications").get();
    const enabled = docSnap.exists ? ((_a = docSnap.data()) === null || _a === void 0 ? void 0 : _a.enabled) !== false : true;
    const uid = ((_b = req.auth) === null || _b === void 0 ? void 0 : _b.uid) || "";
    if (!uid)
        return { enabled, hasToken: false, tokenCount: 0 };
    const userEnabled = await isUserNotificationsEnabled(uid);
    const tokens = await getUserFcmTokens(uid);
    return {
        enabled,
        userEnabled,
        hasToken: tokens.length > 0,
        tokenCount: tokens.length,
    };
});
exports.setNotificationStatus = (0, https_1.onCall)({ region: europeWest2 }, async (req) => {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const uid = (_a = req.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!uid) {
        v2_1.logger.info("setNotificationStatus: UNAUTHENTICATED");
        throw new Error("Unauthenticated");
    }
    const enabled = !!((_b = req.data) === null || _b === void 0 ? void 0 : _b.enabled);
    const tokenRaw = (_c = req.data) === null || _c === void 0 ? void 0 : _c.token;
    const token = typeof tokenRaw === "string" ? tokenRaw.trim() : "";
    const platformRaw = (_d = req.data) === null || _d === void 0 ? void 0 : _d.platform;
    const platform = typeof platformRaw === "string" ? platformRaw.trim() : null;
    v2_1.logger.info("setNotificationStatus: ENTER", {
        uid,
        enabled,
        tokenPresent: !!token,
        tokenLen: token.length,
        keys: req.data ? Object.keys(req.data) : [],
        ua: ((_f = (_e = req.rawRequest) === null || _e === void 0 ? void 0 : _e.headers) === null || _f === void 0 ? void 0 : _f["user-agent"]) || null,
        platform,
    });
    // Store user-level enabled switch
    await db.collection("users").doc(uid).set({
        notificationsEnabled: enabled,
        notificationsUpdatedAt: firebase_admin_1.default.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    const col = db.collection("users").doc(uid).collection("pushTokens");
    if (enabled) {
        if (!token) {
            v2_1.logger.info("setNotificationStatus: MISSING TOKEN", {
                uid,
                keys: req.data ? Object.keys(req.data) : [],
            });
            throw new Error("Missing token");
        }
        await col.doc(token).set({
            token,
            platform,
            updatedAt: firebase_admin_1.default.firestore.FieldValue.serverTimestamp(),
            userAgent: ((_h = (_g = req.rawRequest) === null || _g === void 0 ? void 0 : _g.headers) === null || _h === void 0 ? void 0 : _h["user-agent"]) ||
                null,
        }, { merge: true });
        v2_1.logger.info("setNotificationStatus: SAVED TOKEN", {
            uid,
            tokenLen: token.length,
        });
        return { success: true, enabled: true, debug: { tokenLen: token.length } };
    }
    // enabled=false => remove one token (if provided) or all
    if (token) {
        await col.doc(token).delete().catch(() => { });
        v2_1.logger.info("setNotificationStatus: DELETED ONE TOKEN", {
            uid,
            tokenLen: token.length,
        });
    }
    else {
        const snap = await col.get();
        const batch = db.batch();
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        v2_1.logger.info("setNotificationStatus: DELETED ALL TOKENS", {
            uid,
            count: snap.size,
        });
    }
    return { success: true, enabled: false, debug: { tokenProvided: !!token } };
});
// --------------------
// Schedulers (kept)
// --------------------
exports.projectReviewNotifier = (0, scheduler_1.onSchedule)({ schedule: "every 24 hours", region: europeWest2 }, () => {
    v2_1.logger.log("projectReviewNotifier executed.");
});
exports.pendingShiftNotifier = (0, scheduler_1.onSchedule)({ schedule: "every 1 hours", region: europeWest2 }, () => {
    v2_1.logger.log("pendingShiftNotifier executed.");
});
//# sourceMappingURL=index.js.map