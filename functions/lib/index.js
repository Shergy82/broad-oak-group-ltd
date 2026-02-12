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
exports.serveFile = exports.cleanupDeletedProjects = exports.aiMerchantFinder = exports.deleteAllShifts = exports.onShiftWrite = void 0;
const admin = __importStar(require("firebase-admin"));
const logger = __importStar(require("firebase-functions/logger"));
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-functions/v2/firestore");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const webPush = __importStar(require("web-push"));
const axios_1 = __importDefault(require("axios"));
/* =====================================================
   INIT
===================================================== */
if (admin.apps.length === 0) {
    admin.initializeApp();
}
const db = admin.firestore();
/* =====================================================
   PUSH ENV
===================================================== */
const VAPID_PUBLIC = process.env.WEBPUSH_PUBLIC_KEY || '';
const VAPID_PRIVATE = process.env.WEBPUSH_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.WEBPUSH_SUBJECT || 'mailto:example@your-project.com';
if (VAPID_PUBLIC && VAPID_PRIVATE) {
    webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}
/* =====================================================
   PUSH HELPER
===================================================== */
async function sendWebPushToUser(uid, payload) {
    const snap = await db.collection(`users/${uid}/pushSubscriptions`).get();
    if (snap.empty)
        return;
    for (const docSnap of snap.docs) {
        const sub = docSnap.data()?.subscription;
        if (!sub)
            continue;
        try {
            await webPush.sendNotification(sub, JSON.stringify(payload));
        }
        catch (err) {
            logger.error('Push failed, removing subscription', err);
            await docSnap.ref.delete();
        }
    }
}
/* =====================================================
   SHIFT TRIGGER
===================================================== */
exports.onShiftWrite = (0, firestore_1.onDocumentWritten)({ region: 'europe-west2', document: 'shifts/{shiftId}' }, async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    const doc = after || before;
    if (!doc?.userId)
        return;
    const isCreate = !before && !!after;
    const isDelete = !!before && !after;
    if (isDelete) {
        await sendWebPushToUser(doc.userId, {
            title: 'Shift Cancelled',
            body: 'A shift has been cancelled.',
            url: '/dashboard',
        });
        return;
    }
    await sendWebPushToUser(doc.userId, {
        title: isCreate ? 'New Shift Assigned' : 'Shift Updated',
        body: isCreate
            ? 'You have been assigned a new shift.'
            : 'One of your shifts has been updated.',
        url: '/dashboard',
    });
});
/* =====================================================
   DELETE ALL SHIFTS
===================================================== */
exports.deleteAllShifts = (0, https_1.onCall)({ region: 'europe-west2' }, async (req) => {
    if (!req.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Login required');
    }
    const shiftsRef = db.collection('shifts');
    let totalDeleted = 0;
    while (true) {
        const snap = await shiftsRef.limit(400).get();
        if (snap.empty)
            break;
        const batch = db.batch();
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        totalDeleted += snap.size;
    }
    return { ok: true, deleted: totalDeleted };
});
/* =====================================================
   AI MERCHANT FINDER
===================================================== */
exports.aiMerchantFinder = (0, https_1.onCall)({
    region: 'europe-west2',
    timeoutSeconds: 30,
    secrets: ['GOOGLE_PLACES_KEY'],
}, async (req) => {
    if (!req.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Login required');
    }
    const { message, lat, lng } = req.data;
    if (!message || !lat || !lng) {
        throw new https_1.HttpsError('invalid-argument', 'Message and GPS coordinates required');
    }
    try {
        const response = await axios_1.default.post('https://places.googleapis.com/v1/places:searchText', {
            textQuery: message,
            maxResultCount: 5,
            locationBias: {
                circle: {
                    center: { latitude: lat, longitude: lng },
                    radius: 5000,
                },
            },
        }, {
            headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': process.env.GOOGLE_PLACES_KEY,
                'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.rating,places.googleMapsUri',
            },
        });
        const results = response.data.places?.map((place) => ({
            name: place.displayName?.text,
            rating: place.rating || null,
            address: place.formattedAddress,
            mapsUrl: place.googleMapsUri,
        })) || [];
        return { results };
    }
    catch (err) {
        logger.error('Places API error:', err?.response?.data || err);
        throw new https_1.HttpsError('internal', 'Failed to fetch merchants');
    }
});
/* =====================================================
   CLEANUP SCHEDULE
===================================================== */
exports.cleanupDeletedProjects = (0, scheduler_1.onSchedule)({ schedule: 'every 24 hours', region: 'europe-west2' }, async () => {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const snapshot = await db
        .collection('projects')
        .where('deletionScheduledAt', '<=', admin.firestore.Timestamp.fromDate(sevenDaysAgo))
        .get();
    if (snapshot.empty)
        return;
    const bucket = admin.storage().bucket();
    for (const doc of snapshot.docs) {
        const projectId = doc.id;
        try {
            await bucket.deleteFiles({
                prefix: `project_files/${projectId}/`,
            });
        }
        catch {
            logger.warn(`No storage files found for project ${projectId}`);
        }
        await doc.ref.delete();
    }
});
/* =====================================================
   FILE SERVE
===================================================== */
var files_1 = require("./files");
Object.defineProperty(exports, "serveFile", { enumerable: true, get: function () { return files_1.serveFile; } });
//# sourceMappingURL=index.js.map