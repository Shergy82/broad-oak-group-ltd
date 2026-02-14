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
exports.deleteUser = exports.setUserStatus = exports.setNotificationStatus = exports.getNotificationStatus = void 0;
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
if (admin.apps.length === 0) {
    admin.initializeApp();
}
const db = admin.firestore();
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
    const enabled = req.data?.enabled === true;
    if (typeof enabled !== 'boolean') {
        throw new https_1.HttpsError('invalid-argument', 'enabled must be boolean');
    }
    await db
        .collection('users')
        .doc(req.auth.uid)
        .set({ notificationsEnabled: enabled }, { merge: true });
    return { success: true };
});
/* =====================================================
   USER MANAGEMENT (OWNER ONLY)
===================================================== */
/**
 * Checks if the calling user has the 'owner' role. Throws an HttpsError if not.
 */
const assertIsOwner = async (uid) => {
    if (!uid) {
        throw new https_1.HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }
    const userDoc = await db.collection('users').doc(uid).get();
    const userRole = userDoc.data()?.role;
    if (userRole !== 'owner') {
        throw new https_1.HttpsError('permission-denied', 'You must be an owner to perform this action.');
    }
};
exports.setUserStatus = (0, https_1.onCall)({ region: 'europe-west2' }, async (req) => {
    await assertIsOwner(req.auth?.uid);
    const { uid, disabled, newStatus } = req.data;
    if (typeof uid !== 'string' || typeof disabled !== 'boolean' || (newStatus !== 'active' && newStatus !== 'suspended')) {
        throw new https_1.HttpsError('invalid-argument', 'The function must be called with a `uid`, `disabled` state, and `newStatus`.');
    }
    try {
        // Update Firebase Auth state
        await admin.auth().updateUser(uid, { disabled });
        // Update Firestore document status
        const userDocRef = db.collection('users').doc(uid);
        await userDocRef.update({ status: newStatus });
        return { success: true, message: `User ${uid} status updated to ${newStatus}.` };
    }
    catch (error) {
        console.error("Error updating user status:", error);
        throw new https_1.HttpsError('internal', error.message || 'An unknown error occurred while updating user status.');
    }
});
exports.deleteUser = (0, https_1.onCall)({ region: 'europe-west2' }, async (req) => {
    await assertIsOwner(req.auth?.uid);
    const { uid } = req.data;
    if (typeof uid !== 'string') {
        throw new https_1.HttpsError('invalid-argument', 'The function must be called with a user `uid`.');
    }
    try {
        // Delete from Firebase Auth
        await admin.auth().deleteUser(uid);
        // Delete from Firestore
        await db.collection('users').doc(uid).delete();
        return { success: true, message: `User ${uid} has been deleted.` };
    }
    catch (error) {
        console.error("Error deleting user:", error);
        throw new https_1.HttpsError('internal', error.message || 'An unknown error occurred while deleting the user.');
    }
});
//# sourceMappingURL=index.js.map