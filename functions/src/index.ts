import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentCreated, onDocumentDeleted, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";
import admin from "firebase-admin";
import JSZip from 'jszip';
import { getStorage } from 'firebase-admin/storage';


if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const europeWest2 = "europe-west2";

// --- Recursive Delete Helper ---
async function deleteCollection(collectionRef: admin.firestore.CollectionReference, batchSize: number) {
    const query = collectionRef.limit(batchSize);
  
    return new Promise((resolve, reject) => {
      deleteQueryBatch(query, resolve, reject).catch(reject);
    });
}
  
async function deleteQueryBatch(query: admin.firestore.Query, resolve: (value: unknown) => void, reject: (reason?: any) => void) {
    const snapshot = await query.get();

    const batchSize = snapshot.size;
    if (batchSize === 0) {
        // When there are no documents left, we are done
        resolve(true);
        return;
    }

    // Delete documents in a batch
    const batch = db.batch();
    snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
    });
    await batch.commit();

    // Recurse on the next process tick, to avoid
    // exploding the stack.
    process.nextTick(() => {
        deleteQueryBatch(query, resolve, reject).catch(reject);
    });
}

// --- Functions ---
export const setNotificationStatus = onCall({ region: europeWest2, cors: true }, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) {
        throw new HttpsError("unauthenticated", "User must be logged in.");
    }

    try {
        const enabled = !!req.data?.enabled;
        const token = (req.data?.token || "").trim();

        const userRef = db.collection("users").doc(uid);
        const pushTokensCollection = userRef.collection("pushTokens");

        await userRef.set({ notificationsEnabled: enabled }, { merge: true });

        if (enabled && token) {
            const q = pushTokensCollection.where("token", "==", token);
            const existingDocs = await q.get();

            if (existingDocs.empty) {
                await pushTokensCollection.add({
                    token: token,
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    platform: req.data?.platform || "web",
                    userAgent: req.rawRequest?.headers?.["user-agent"] || null,
                });
            }
        } else if (!enabled && token) {
            const q = pushTokensCollection.where("token", "==", token);
            const snapshot = await q.get();
            if (!snapshot.empty) {
                const batch = db.batch();
                snapshot.docs.forEach((doc) => batch.delete(doc.ref));
                await batch.commit();
            }
        }
        
        return { success: true };

    } catch (error: any) {
        logger.error("Error in setNotificationStatus:", { uid, message: error.message });
        throw new HttpsError("internal", "Failed to update notification status.");
    }
});


export const deleteProjectAndFiles = onCall({ region: europeWest2, timeoutSeconds: 540, cors: true }, async (req) => {
    const uid = req.auth?.uid;
    const userDoc = await db.collection("users").doc(uid!).get();
    const userProfile = userDoc.data();
    if (!userProfile || !['admin', 'owner', 'manager'].includes(userProfile.role)) {
      throw new HttpsError("permission-denied", "You do not have permission.");
    }
    const projectId = req.data.projectId;
    if (!projectId) {
      throw new HttpsError("invalid-argument", "Missing projectId.");
    }

    const bucket = admin.storage().bucket();
    const prefix = `project_files/${projectId}/`;
    await bucket.deleteFiles({ prefix });
    
    const projectRef = db.collection('projects').doc(projectId);
    const filesCollectionRef = projectRef.collection('files');
    await deleteCollection(filesCollectionRef, 200);
    await projectRef.delete();

    return { success: true };
});

export const deleteAllProjects = onCall({ region: europeWest2, timeoutSeconds: 540, cors: true }, async (req) => {
    const uid = req.auth?.uid;
    const userDoc = await db.collection("users").doc(uid!).get();
    const userProfile = userDoc.data();

    if (!userProfile || userProfile.role !== 'owner') {
      throw new HttpsError("permission-denied", "Only the owner can perform this action.");
    }

    const projectsSnapshot = await db.collection('projects').get();
    if (projectsSnapshot.empty) return { success: true, message: "No projects to delete." };

    const bucket = admin.storage().bucket();
    const allProjectPrefixes = projectsSnapshot.docs.map(doc => `project_files/${doc.id}/`);
    
    // This can be slow, but is safer.
    for (const prefix of allProjectPrefixes) {
      await bucket.deleteFiles({ prefix });
    }
    
    for (const doc of projectsSnapshot.docs) {
      await deleteCollection(doc.ref.collection('files'), 200);
      await doc.ref.delete();
    }
    
    return { success: true, message: `Successfully deleted ${projectsSnapshot.size} projects.` };
});

export const deleteUser = onCall({ region: europeWest2, cors: true }, async (req) => {
    const callerUid = req.auth?.uid;
    const callerDoc = await db.collection("users").doc(callerUid!).get();
    const callerProfile = callerDoc.data();

    if (!callerProfile || callerProfile.role !== 'owner') {
      throw new HttpsError("permission-denied", "Only the account owner can delete users.");
    }

    const uidToDelete = req.data.uid;
    if (!uidToDelete) throw new HttpsError("invalid-argument", "UID is required.");
    if (uidToDelete === callerUid) throw new HttpsError("permission-denied", "Owner cannot delete their own account.");

    try {
        await admin.auth().deleteUser(uidToDelete);
        const userRef = db.collection("users").doc(uidToDelete);
        await deleteCollection(userRef.collection('pushSubscriptions'), 50);
        await userRef.delete();
        return { success: true };
    } catch(error: any) {
        if (error.code === 'auth/user-not-found') {
            const userRef = db.collection("users").doc(uidToDelete);
            await deleteCollection(userRef.collection('pushSubscriptions'), 50);
            await userRef.delete();
            return { success: true, message: "User already deleted from Auth, cleaned up Firestore." };
        }
        logger.error(`Error deleting user ${uidToDelete}:`, error);
        throw new HttpsError("internal", "An unexpected error occurred.");
    }
});

// Stubs for other functions from user's code
export const getVapidPublicKey = onCall({ region: europeWest2, cors: true }, () => {
    // This is a stub, assuming the key is in env vars on App Hosting
    return { publicKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY || '' };
});
export const getNotificationStatus = onCall({ region: europeWest2, cors: true }, async (req) => ({ enabled: true }));
export const onShiftCreated = onDocumentCreated({ document: "shifts/{shiftId}", region: europeWest2 }, (event) => { logger.log("onShiftCreated triggered", event.params); });
export const onShiftUpdated = onDocumentUpdated({ document: "shifts/{shiftId}", region: europeWest2 }, (event) => { logger.log("onShiftUpdated triggered", event.params); });
export const onShiftDeleted = onDocumentDeleted({ document: "shifts/{shiftId}", region: europeWest2 }, (event) => { logger.log("onShiftDeleted triggered", event.params); });
export const projectReviewNotifier = onSchedule({ schedule: "every 24 hours", region: europeWest2 }, () => { logger.log("projectReviewNotifier executed."); });
export const pendingShiftNotifier = onSchedule({ schedule: "every 1 hours", region: europeWest2 }, () => { logger.log("pendingShiftNotifier executed."); });
export const deleteAllShifts = onCall({ region: europeWest2, cors: true }, async (req) => ({ success: true, message: "OK" }));
export const deleteProjectFile = onCall({ region: europeWest2, cors: true }, async (req) => ({ success: true, message: "OK" }));
export const zipProjectFiles = onCall({ region: europeWest2, cors: true }, async (req) => ({ success: false, message: "Not implemented"}));
