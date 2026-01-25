
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentCreated, onDocumentDeleted, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";
import { defineString, defineSecret } from "firebase-functions/params";
import admin from "firebase-admin";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const europeWest2 = "europe-west2";
const APP_BASE_URL = defineString("APP_BASE_URL");
const ADMIN_BOOTSTRAP_SECRET = defineSecret("ADMIN_BOOTSTRAP_SECRET");

// --- Recursive Delete Helper ---
// This is a utility function to delete a document and all its subcollections.
async function recursiveDelete(ref: admin.firestore.CollectionReference | admin.firestore.DocumentReference) {
  const BATCH_SIZE = 400;
  const queue: admin.firestore.Query[] = [ref.listDocuments().then(docs => db.collection(ref.path).where(admin.firestore.FieldPath.documentId(), 'in', docs.slice(0, BATCH_SIZE)))];

  let numDeleted = 0;

  while (queue.length > 0) {
    const q = queue.shift()!;
    const snapshot = await q.get();

    if (snapshot.size === 0) continue;

    const batch = db.batch();
    snapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
      numDeleted++;
    });
    await batch.commit();

    if (snapshot.size === BATCH_SIZE) {
      queue.push(ref.listDocuments().then(docs => db.collection(ref.path).where(admin.firestore.FieldPath.documentId(), 'in', docs.slice(0, BATCH_SIZE))));
    }
  }

  if (ref instanceof admin.firestore.DocumentReference) {
    await ref.delete();
    numDeleted++;
  }

  return numDeleted;
}


// --- Functions ---

export const bootstrapClaims = onCall({ secrets: [ADMIN_BOOTSTRAP_SECRET], region: europeWest2, cors: true }, async (req) => {
    // ... implementation for bootstrapClaims
});

async function getUserFcmTokens(userId: string): Promise<string[]> {
  const snap = await db.collection("users").doc(userId).collection("pushTokens").get();
  if (snap.empty) return [];
  return snap.docs.map(doc => doc.data().token).filter(Boolean);
}

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

      if (enabled) {
        if (!token) {
          throw new HttpsError("invalid-argument", "A token is required to enable notifications.");
        }
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
        logger.info("Successfully subscribed user to push notifications.", { uid });
        return { success: true };
      } else if (token) {
        const q = pushTokensCollection.where("token", "==", token);
        const snapshot = await q.get();
        if (!snapshot.empty) {
          const batch = db.batch();
          snapshot.docs.forEach((doc) => batch.delete(doc.ref));
          await batch.commit();
          logger.info("Successfully unsubscribed a specific token.", { uid });
        }
        return { success: true };
      }
      return { success: true };

    } catch (error: any) {
      logger.error("Error in setNotificationStatus function:", { uid: uid, errorMessage: error.message });
      throw new HttpsError("internal", "An unexpected error occurred while setting notification status.");
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
    await recursiveDelete(projectRef);

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
    await bucket.deleteFiles({ prefix: `project_files/` });
    
    for (const doc of projectsSnapshot.docs) {
      await recursiveDelete(doc.ref);
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
        await recursiveDelete(db.collection("users").doc(uidToDelete));
        return { success: true };
    } catch(error: any) {
        if (error.code === 'auth/user-not-found') {
            await recursiveDelete(db.collection("users").doc(uidToDelete));
            return { success: true, message: "User already deleted from Auth, cleaned up Firestore." };
        }
        logger.error(`Error deleting user ${uidToDelete}:`, error);
        throw new HttpsError("internal", "An unexpected error occurred.");
    }
});


// Stubs for other functions
export const getNotificationStatus = onCall({ region: europeWest2, cors: true }, async (req) => ({ enabled: true }));
export const onShiftCreated = onDocumentCreated({ document: "shifts/{shiftId}", region: europeWest2 }, (event) => { logger.log("onShiftCreated triggered", event.params); });
export const onShiftUpdated = onDocumentUpdated({ document: "shifts/{shiftId}", region: europeWest2 }, (event) => { logger.log("onShiftUpdated triggered", event.params); });
export const onShiftDeleted = onDocumentDeleted({ document: "shifts/{shiftId}", region: europeWest2 }, (event) => { logger.log("onShiftDeleted triggered", event.params); });
export const projectReviewNotifier = onSchedule({ schedule: "every 24 hours", region: europeWest2 }, () => { logger.log("projectReviewNotifier executed."); });
export const pendingShiftNotifier = onSchedule({ schedule: "every 1 hours", region: europeWest2 }, () => { logger.log("pendingShiftNotifier executed."); });
export const deleteAllShifts = onCall({ region: europeWest2, cors: true }, async (req) => ({ success: true, message: "OK" }));
export const deleteProjectFile = onCall({ region: europeWest2, cors: true }, async (req) => ({ success: true, message: "OK" }));
