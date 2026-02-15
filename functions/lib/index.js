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
exports.reGeocodeAllShifts = exports.deleteUser = exports.setUserStatus = exports.setNotificationStatus = exports.getNotificationStatus = void 0;
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
const node_fetch_1 = __importDefault(require("node-fetch"));
if (admin.apps.length === 0) {
    admin.initializeApp();
}
const db = admin.firestore();
/* =====================================================
   ENV
===================================================== */
const GEOCODING_KEY = process.env.GOOGLE_GEOCODING_KEY ||
    require('firebase-functions').config().google.geocoding_key;
/* =====================================================
   NOTIFICATION STATUS (REQUIRED BY FRONTEND)
===================================================== */
exports.getNotificationStatus = (0, https_1.onCall)({ region: 'europe-west2' }, async (req) => {
    if (!req.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Login required');
    }
    const doc = await db.collection('users').doc(req.auth.uid).get();
    return { enabled: doc.data()?.notificationsEnabled ?? false };
});
exports.setNotificationStatus = (0, https_1.onCall)({ region: 'europe-west2' }, async (req) => {
    if (!req.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Login required');
    }
    if (typeof req.data?.enabled !== 'boolean') {
        throw new https_1.HttpsError('invalid-argument', 'enabled must be boolean');
    }
    await db
        .collection('users')
        .doc(req.auth.uid)
        .set({ notificationsEnabled: req.data.enabled }, { merge: true });
    return { success: true };
});
/* =====================================================
   USER MANAGEMENT (OWNER ONLY)
===================================================== */
const assertIsOwner = async (uid) => {
    if (!uid) {
        throw new https_1.HttpsError('unauthenticated', 'Authentication required');
    }
    const snap = await db.collection('users').doc(uid).get();
    if (snap.data()?.role !== 'owner') {
        throw new https_1.HttpsError('permission-denied', 'Owner role required');
    }
};
exports.setUserStatus = (0, https_1.onCall)({ region: 'europe-west2' }, async (req) => {
    await assertIsOwner(req.auth?.uid);
    const { uid, disabled, newStatus } = req.data;
    if (typeof uid !== 'string' ||
        typeof disabled !== 'boolean' ||
        !['active', 'suspended'].includes(newStatus)) {
        throw new https_1.HttpsError('invalid-argument', 'uid, disabled, and valid newStatus are required');
    }
    await admin.auth().updateUser(uid, { disabled });
    await db.collection('users').doc(uid).update({ status: newStatus });
    return { success: true };
});
exports.deleteUser = (0, https_1.onCall)({ region: 'europe-west2' }, async (req) => {
    await assertIsOwner(req.auth?.uid);
    const { uid } = req.data;
    if (typeof uid !== 'string') {
        throw new https_1.HttpsError('invalid-argument', 'uid is required');
    }
    await admin.auth().deleteUser(uid);
    await db.collection('users').doc(uid).delete();
    return { success: true };
});
/* =====================================================
   ONE-OFF: RE-GEOCODE ALL SHIFTS
===================================================== */
exports.reGeocodeAllShifts = (0, https_1.onCall)({
    region: 'europe-west2',
    timeoutSeconds: 540,
    memory: '1GiB',
}, async (req) => {
    await assertIsOwner(req.auth?.uid);
    if (!GEOCODING_KEY) {
        throw new https_1.HttpsError('failed-precondition', 'Missing Google Geocoding API key');
    }
    const snap = await db.collection('shifts').get();
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    for (const doc of snap.docs) {
        const data = doc.data();
        if (!data?.address) {
            skipped++;
            continue;
        }
        const address = encodeURIComponent(`${data.address}, UK`);
        const url = `https://maps.googleapis.com/maps/api/geocode/json?` +
            `address=${address}&key=${GEOCODING_KEY}`;
        try {
            const res = await (0, node_fetch_1.default)(url);
            const json = await res.json();
            if (json.status !== 'OK' || !json.results?.length) {
                failed++;
                continue;
            }
            const result = json.results[0];
            const { lat, lng } = result.geometry.location;
            const accuracy = result.geometry.location_type;
            await doc.ref.update({
                location: {
                    lat,
                    lng,
                    accuracy, // ROOFTOP | RANGE_INTERPOLATED | POSTAL_CODE
                },
            });
            updated++;
        }
        catch (err) {
            failed++;
        }
    }
    return { updated, skipped, failed };
});
//# sourceMappingURL=index.js.map