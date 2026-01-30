
'use server';
import * as functions from "firebase-functions";
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

// All notification-related functions have been removed.

export const deleteProjectAndFiles = functions.region("europe-west2").https.onCall(async (data, context) => {
    functions.logger.log("Received request to delete project:", data.projectId);

    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "You must be logged in to delete a project.");
    }
    const uid = context.auth.uid;
    const userDoc = await db.collection("users").doc(uid).get();
    const userProfile = userDoc.data();

    if (!userProfile || !['admin', 'owner', 'manager'].includes(userProfile.role)) {
        throw new functions.https.HttpsError("permission-denied", "You do not have permission to perform this action.");
    }
    
    const projectId = data.projectId;
    if (!projectId || typeof projectId !== 'string') {
        throw new functions.https.HttpsError("invalid-argument", "The function must be called with a 'projectId' string argument.");
    }

    try {
        const bucket = admin.storage().bucket();
        const prefix = `project_files/${projectId}/`;
        
        await bucket.deleteFiles({ prefix });
        functions.logger.log(`Successfully deleted all files with prefix "${prefix}" from Storage.`);

        const projectRef = db.collection('projects').doc(projectId);
        const filesQuerySnapshot = await projectRef.collection('files').get();
        
        const batch = db.batch();
        
        filesQuerySnapshot.forEach(doc => {
            batch.delete(doc.ref);
        });

        batch.delete(projectRef);
        await batch.commit();
        functions.logger.log(`Successfully deleted project ${projectId} and its subcollections from Firestore.`);

        return { success: true, message: `Project ${projectId} and all associated files deleted successfully.` };

    } catch (error: any) {
        functions.logger.error(`Error deleting project ${projectId}:`, error);
        throw new functions.https.HttpsError("internal", "An unexpected error occurred while deleting the project. Please check the function logs.");
    }
});


export const deleteProjectFile = functions.region("europe-west2").https.onCall(async (data, context) => {
    functions.logger.log("Received request to delete file:", data);

    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "You must be logged in to delete a file.");
    }
    const uid = context.auth.uid;
    const { projectId, fileId } = data;

    if (!projectId || typeof projectId !== 'string' || !fileId || typeof fileId !== 'string') {
        throw new functions.https.HttpsError("invalid-argument", "The function requires 'projectId' and 'fileId' arguments.");
    }

    try {
        const fileRef = db.collection('projects').doc(projectId).collection('files').doc(fileId);
        const fileDoc = await fileRef.get();

        if (!fileDoc.exists) {
            throw new functions.https.HttpsError("not-found", "The specified file does not exist.");
        }

        const fileData = fileDoc.data()!;
        
        if (!fileData || !fileData.fullPath || !fileData.uploaderId) {
            functions.logger.error(`File document ${fileId} in project ${projectId} is missing required data ('fullPath' or 'uploaderId'). Deleting Firestore record.`, { fileData });
            await fileRef.delete();
            throw new functions.https.HttpsError("internal", "The file's database record was corrupt and has been removed. The file may still exist in storage.");
        }
        
        const uploaderId = fileData.uploaderId;
        const userDoc = await db.collection("users").doc(uid).get();
        const userProfile = userDoc.data();
        const isPrivileged = userProfile && ['admin', 'owner', 'manager'].includes(userProfile.role);
        const isUploader = uid === uploaderId;

        if (!isPrivileged && !isUploader) {
            throw new functions.https.HttpsError("permission-denied", "You do not have permission to delete this file.");
        }

        const storageFileRef = admin.storage().bucket().file(fileData.fullPath);
        await storageFileRef.delete();
        functions.logger.log(`Successfully deleted file from Storage: ${fileData.fullPath}`);

        await fileRef.delete();
        functions.logger.log(`Successfully deleted file record from Firestore: ${fileId}`);
        
        return { success: true, message: `File ${fileId} deleted successfully.` };

    } catch (error: any) {
        functions.logger.error(`Error deleting file ${fileId} from project ${projectId}:`, error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError("internal", "An unexpected error occurred while deleting the file. Please check the function logs.");
    }
});


export const deleteAllShifts = functions.region("europe-west2").https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "You must be logged in.");
    }
    const uid = context.auth.uid;
    const userDoc = await db.collection("users").doc(uid).get();
    const userProfile = userDoc.data();

    if (!userProfile || userProfile.role !== 'owner') {
        throw new functions.https.HttpsError("permission-denied", "Only the account owner can perform this action.");
    }
    
    functions.logger.log(`Owner ${uid} initiated deletion of all active shifts.`);

    try {
        const activeShiftStatuses = ['pending-confirmation', 'confirmed', 'on-site', 'rejected'];
        const shiftsCollection = db.collection('shifts');
        const snapshot = await shiftsCollection.where('status', 'in', activeShiftStatuses).get();
        
        if (snapshot.empty) {
            return { success: true, message: "No active shifts to delete." };
        }

        const batchSize = 500;
        const batches = [];
        for (let i = 0; i < snapshot.docs.length; i += batchSize) {
            const batch = db.batch();
            const chunk = snapshot.docs.slice(i, i + batchSize);
            chunk.forEach(doc => batch.delete(doc.ref));
            batches.push(batch.commit());
        }

        await Promise.all(batches);

        functions.logger.log(`Successfully deleted ${snapshot.size} active shifts.`);
        return { success: true, message: `Successfully deleted ${snapshot.size} active shifts.` };
    } catch (error) {
        functions.logger.error("Error deleting all shifts:", error);
        throw new functions.https.HttpsError("internal", "An unexpected error occurred while deleting shifts.");
    }
});

export const deleteAllProjects = functions.region("europe-west2").https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "You must be logged in.");
    }
    const uid = context.auth.uid;
    const userDoc = await db.collection("users").doc(uid).get();
    const userProfile = userDoc.data();

    if (!userProfile || userProfile.role !== 'owner') {
        throw new functions.https.HttpsError("permission-denied", "Only the account owner can perform this action.");
    }

    functions.logger.log(`Owner ${uid} initiated deletion of ALL projects and files.`);

    try {
        const projectsQuerySnapshot = await db.collection('projects').get();
        if (projectsQuerySnapshot.empty) {
            return { success: true, message: "No projects to delete." };
        }

        const bucket = admin.storage().bucket();
        const storagePromises = projectsQuerySnapshot.docs.map(projectDoc => {
            const prefix = `project_files/${projectDoc.id}/`;
            return bucket.deleteFiles({ prefix });
        });
        await Promise.all(storagePromises);
        functions.logger.log("Successfully deleted all project files from Storage.");

        const firestoreDeletions: Promise<any>[] = [];
        for (const projectDoc of projectsQuerySnapshot.docs) {
            const filesCollectionRef = projectDoc.ref.collection('files');
            const filesSnapshot = await filesCollectionRef.get();
            if (!filesSnapshot.empty) {
                 const batchSize = 500;
                 for (let i = 0; i < filesSnapshot.docs.length; i += batchSize) {
                    const batch = db.batch();
                    const chunk = filesSnapshot.docs.slice(i, i + batchSize);
                    chunk.forEach(doc => batch.delete(doc.ref));
                    firestoreDeletions.push(batch.commit());
                }
            }
            firestoreDeletions.push(projectDoc.ref.delete());
        }
        
        await Promise.all(firestoreDeletions);

        functions.logger.log("Successfully deleted all projects and their subcollections from Firestore.");
        return { success: true, message: `Successfully deleted ${projectsQuerySnapshot.size} projects and all associated files.` };

    } catch (error) {
        functions.logger.error("Error deleting all projects:", error);
        throw new functions.https.HttpsError("internal", "An error occurred while deleting all projects. Please check the function logs.");
    }
});

export const setUserStatus = functions.region("europe-west2").https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "You must be logged in.");
    }
    const callerUid = context.auth.uid;
    const callerDoc = await db.collection("users").doc(callerUid).get();
    const callerProfile = callerDoc.data();

    if (!callerProfile || callerProfile.role !== 'owner') {
        throw new functions.https.HttpsError("permission-denied", "Only the account owner can change user status.");
    }
    
    const { uid, disabled, newStatus } = data;
    const validStatuses = ['active', 'suspended', 'pending-approval'];

    if (typeof uid !== 'string' || typeof disabled !== 'boolean' || !validStatuses.includes(newStatus)) {
        throw new functions.https.HttpsError("invalid-argument", `Invalid arguments provided. 'uid' must be a string, 'disabled' a boolean, and 'newStatus' must be one of ${validStatuses.join(', ')}.`);
    }

    if (uid === callerUid) {
        throw new functions.https.HttpsError("permission-denied", "The account owner cannot suspend their own account.");
    }
    
    try {
        await admin.auth().updateUser(uid, { disabled });
        
        const userDocRef = db.collection('users').doc(uid);
        await userDocRef.update({ status: newStatus });
        
        functions.logger.log(`Owner ${callerUid} has set user ${uid} to status: ${newStatus} (Auth disabled: ${disabled}).`);

        return { success: true };
    } catch (error: any) {
        functions.logger.error(`Error updating status for user ${uid}:`, error);
        throw new functions.https.HttpsError("internal", `An unexpected error occurred while updating user status: ${error.message}`);
    }
});

export const deleteUser = functions.region("europe-west2").https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "You must be logged in.");
  }

  const callerUid = context.auth.uid;
  const callerDoc = await db.collection("users").doc(callerUid).get();
  const callerProfile = callerDoc.data() as { role: string } | undefined;

  if (!callerProfile || callerProfile.role !== 'owner') {
    throw new functions.https.HttpsError("permission-denied", "Only the account owner can delete users.");
  }

  const { uid } = data;
  if (typeof uid !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "The function requires a 'uid' (string) argument.");
  }
  if (uid === callerUid) {
    throw new functions.https.HttpsError("permission-denied", "The account owner cannot delete their own account.");
  }

  try {
    await db.collection("users").doc(uid).delete();
    functions.logger.log(`Deleted Firestore document for user ${uid}.`);

    await admin.auth().deleteUser(uid);
    functions.logger.log(`Deleted Firebase Auth user ${uid}.`);

    functions.logger.log(`Owner ${callerUid} successfully deleted user ${uid}`);
    return { success: true };

  } catch (error: any) {
    functions.logger.error(`Error deleting user ${uid}:`, error);
    if (error.code === "auth/user-not-found") {
      functions.logger.warn(`User ${uid} was already deleted from Firebase Auth. Continuing cleanup.`);
      return { success: true, message: "User was already deleted from Authentication. Cleanup finished." };
    }
    throw new functions.https.HttpsError("internal", `An unexpected error occurred while deleting the user: ${error.message}`);
  }
});

export const syncUserNamesToShifts = functions.region("europe-west2").https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "You must be logged in.");
    }
    const callerDoc = await db.collection("users").doc(context.auth.uid).get();
    if (callerDoc.data()?.role !== 'owner') {
        throw new functions.https.HttpsError("permission-denied", "Only the account owner can run this utility.");
    }

    functions.logger.log("Starting utility to sync user names to shifts.");

    try {
        const usersSnapshot = await db.collection('users').get();
        const userMap = new Map<string, string>();
        usersSnapshot.forEach(doc => {
            userMap.set(doc.id, doc.data().name);
        });

        const shiftsSnapshot = await db.collection('shifts').get();
        if (shiftsSnapshot.empty) {
            return { success: true, message: "No shifts found to process." };
        }

        const batchSize = 400; // Firestore batch limit is 500 operations
        let writeCount = 0;
        let totalUpdated = 0;
        
        let batch = db.batch();

        for (const shiftDoc of shiftsSnapshot.docs) {
            const shiftData = shiftDoc.data();
            // Only update if userName is missing or incorrect
            if (shiftData.userId && userMap.has(shiftData.userId) && shiftData.userName !== userMap.get(shiftData.userId)) {
                batch.update(shiftDoc.ref, { userName: userMap.get(shiftData.userId) });
                writeCount++;
                totalUpdated++;
            }

            if (writeCount >= batchSize) {
                await batch.commit();
                functions.logger.log(`Committed a batch of ${writeCount} updates.`);
                batch = db.batch();
                writeCount = 0;
            }
        }

        if (writeCount > 0) {
            await batch.commit();
            functions.logger.log(`Committed the final batch of ${writeCount} updates.`);
        }

        functions.logger.log(`Sync complete. Total shifts updated: ${totalUpdated}.`);
        return { success: true, message: `Sync complete. ${totalUpdated} shifts were updated with the correct user name.` };

    } catch (error: any) {
        functions.logger.error("Error syncing user names to shifts:", error);
        throw new functions.https.HttpsError("internal", "An unexpected error occurred during the sync process.");
    }
});
