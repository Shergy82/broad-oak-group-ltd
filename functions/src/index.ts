import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import JSZip from 'jszip';


/* =====================================================
   Bootstrap
===================================================== */

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();

/* =====================================================
   ENV
===================================================== */

const GEOCODING_KEY = process.env.GOOGLE_GEOCODING_KEY;

/* =====================================================
   NOTIFICATION STATUS
===================================================== */

export const getNotificationStatus = onCall(
  { region: 'europe-west2' },
  async (req) => {
    if (!req.auth) {
      throw new HttpsError('unauthenticated', 'Login required');
    }

    const doc = await db.collection('users').doc(req.auth.uid).get();
    return { enabled: doc.data()?.notificationsEnabled ?? false };
  }
);

export const setNotificationStatus = onCall(
  { region: 'europe-west2' },
  async (req) => {
    if (!req.auth) {
      throw new HttpsError('unauthenticated', 'Login required');
    }

    const uid = req.auth.uid;

    if (typeof req.data?.enabled !== 'boolean') {
      throw new HttpsError('invalid-argument', 'enabled must be boolean');
    }

    /* 1️⃣ Save user preference */
    await db
      .collection('users')
      .doc(uid)
      .set(
        { notificationsEnabled: req.data.enabled },
        { merge: true }
      );

    /* 2️⃣ Restore previous behaviour:
          store browser push subscription if provided */
    if (req.data.subscription && req.data.enabled === true) {
      await db
        .collection('users')
        .doc(uid)
        .collection('pushSubscriptions')
        .doc('browser')
        .set(req.data.subscription, { merge: true });
    }

    return { success: true };
  }
);

/* =====================================================
   USER MANAGEMENT (OWNER ONLY)
===================================================== */

const assertIsOwner = async (uid?: string) => {
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  const snap = await db.collection('users').doc(uid).get();
  if (snap.data()?.role !== 'owner') {
    throw new HttpsError('permission-denied', 'Owner role required');
  }
};

export const setUserStatus = onCall(
  { region: 'europe-west2' },
  async (req) => {
    await assertIsOwner(req.auth?.uid);

    const { uid, disabled, newStatus } = req.data;

    if (
      typeof uid !== 'string' ||
      typeof disabled !== 'boolean' ||
      !['active', 'suspended'].includes(newStatus)
    ) {
      throw new HttpsError(
        'invalid-argument',
        'uid, disabled, and valid newStatus are required'
      );
    }

    await admin.auth().updateUser(uid, { disabled });
    await db.collection('users').doc(uid).update({ status: newStatus });

    return { success: true };
  }
);

export const deleteUser = onCall(
  { region: 'europe-west2' },
  async (req) => {
    await assertIsOwner(req.auth?.uid);

    const { uid } = req.data;
    if (typeof uid !== 'string') {
      throw new HttpsError('invalid-argument', 'uid is required');
    }

    await admin.auth().deleteUser(uid);
    await db.collection('users').doc(uid).delete();

    return { success: true };
  }
);

/* =====================================================
   PROJECT & FILE MANAGEMENT
===================================================== */

export const deleteProjectAndFiles = onCall<{ projectId: string }>(
  { region: 'europe-west2', timeoutSeconds: 540, memory: '1GiB' },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }
    const userSnap = await db.collection('users').doc(uid).get();
    const userRole = userSnap.data()?.role;
    if (!['admin', 'owner', 'manager'].includes(userRole)) {
      throw new HttpsError('permission-denied', 'You do not have permission to perform this action.');
    }

    const { projectId } = req.data;
    if (!projectId) {
      throw new HttpsError('invalid-argument', 'projectId is required');
    }

    const bucket = admin.storage().bucket();
    const projectRef = db.collection('projects').doc(projectId);

    // Delete files in storage
    const storagePath = `project_files/${projectId}/`;
    await bucket.deleteFiles({ prefix: storagePath });

    // Delete firestore subcollection
    const filesSnap = await projectRef.collection('files').get();
    if (!filesSnap.empty) {
        const batch = db.batch();
        filesSnap.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
    }
    
    // Delete project doc
    await projectRef.delete();

    return { success: true, message: 'Project and files deleted.' };
  }
);

export const deleteAllProjects = onCall(
  { region: 'europe-west2', timeoutSeconds: 540, memory: '1GiB' },
  async (req) => {
    await assertIsOwner(req.auth?.uid);

    const projectsSnap = await db.collection('projects').get();
    if (projectsSnap.empty) {
        return { success: true, message: 'No projects to delete.' };
    }
    const bucket = admin.storage().bucket();

    for (const projectDoc of projectsSnap.docs) {
      const projectId = projectDoc.id;
      const storagePath = `project_files/${projectId}/`;
      await bucket.deleteFiles({ prefix: storagePath }).catch(e => console.error(`Failed to delete storage for ${projectId}`, e));
      
      const filesSnap = await projectDoc.ref.collection('files').get();
       if (!filesSnap.empty) {
            const batch = db.batch();
            filesSnap.docs.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
       }

      await projectDoc.ref.delete();
    }
    
    return { success: true, message: `Deleted ${projectsSnap.size} projects and their files.` };
  }
);

export const deleteProjectFile = onCall<{ projectId: string, fileId: string }>(
  { region: 'europe-west2' },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) {
        throw new HttpsError('unauthenticated', 'Authentication required.');
    }
    const userSnap = await db.collection('users').doc(uid).get();
    const userRole = userSnap.data()?.role;

    const { projectId, fileId } = req.data;
    if (!projectId || !fileId) {
      throw new HttpsError('invalid-argument', 'projectId and fileId are required');
    }

    const fileRef = db.collection('projects').doc(projectId).collection('files').doc(fileId);
    const fileDoc = await fileRef.get();
    if (!fileDoc.exists) {
        return { success: true, message: 'File already deleted.' };
    }

    const fileData = fileDoc.data();
    const uploaderId = fileData?.uploaderId;

    if (uid !== uploaderId && !['admin', 'owner', 'manager'].includes(userRole)) {
        throw new HttpsError('permission-denied', 'You do not have permission to delete this file.');
    }
    
    if (fileData?.fullPath) {
        const bucket = admin.storage().bucket();
        await bucket.file(fileData.fullPath).delete().catch(e => console.error(`Storage deletion failed for ${fileData.fullPath}`, e));
    }

    await fileRef.delete();
    
    return { success: true, message: 'File deleted.' };
  }
);


export const zipProjectFiles = onCall<{ projectId: string }, { downloadUrl: string }>(
  { region: 'europe-west2', timeoutSeconds: 300, memory: '1GiB' },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }
    const { projectId } = req.data;
    if (!projectId) {
      throw new HttpsError('invalid-argument', 'projectId is required');
    }
    
    const projectDoc = await db.collection('projects').doc(projectId).get();
    if (!projectDoc.exists) {
      throw new HttpsError('not-found', 'Project not found.');
    }
    const projectAddress = projectDoc.data()?.address.replace(/[^a-zA-Z0-9]/g, '_') || 'project';


    const filesSnap = await db.collection('projects').doc(projectId).collection('files').get();
    if (filesSnap.empty) {
        throw new HttpsError('not-found', 'No files to zip for this project.');
    }
    
    const zip = new JSZip();
    const bucket = admin.storage().bucket();
    
    // Using Promise.all to download files in parallel
    await Promise.all(filesSnap.docs.map(async (fileDoc) => {
        const fileData = fileDoc.data();
        if (fileData.fullPath) {
            try {
                const [fileContents] = await bucket.file(fileData.fullPath).download();
                zip.file(fileData.name, fileContents);
            } catch (e) {
                console.error(`Could not download file ${fileData.fullPath}`, e);
                // Optionally add a text file to the zip indicating failure for this file
                zip.file(`FAILED_TO_DOWNLOAD_${fileData.name}.txt`, `Could not access file: ${fileData.name}`);
            }
        }
    }));
    
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    
    const zipFileName = `archives/${projectId}/${projectAddress}_${Date.now()}.zip`;
    const file = bucket.file(zipFileName);
    
    await file.save(zipBuffer, {
      contentType: 'application/zip',
    });
    
    const [downloadUrl] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 15 * 60 * 1000, // 15 minutes
    });

    return { downloadUrl };
  }
);

/* =====================================================
   SHIFT MANAGEMENT
===================================================== */

export const deleteAllShifts = onCall({ region: 'europe-west2' }, async (req) => {
    await assertIsOwner(req.auth?.uid);

    const FINAL_STATUSES = ['completed', 'incomplete', 'rejected'];
    const shiftsQuery = db.collection('shifts');
    const shiftsSnap = await shiftsQuery.get();

    if (shiftsSnap.empty) {
        return { success: true, message: 'No shifts to delete.' };
    }
    
    const batch = db.batch();
    let deletedCount = 0;
    shiftsSnap.docs.forEach(doc => {
        const shift = doc.data();
        if (!FINAL_STATUSES.includes(shift.status)) {
            batch.delete(doc.ref);
            deletedCount++;
        }
    });

    await batch.commit();

    return { success: true, message: `Deleted ${deletedCount} active shifts.` };
});


/* =====================================================
   ONE-OFF: RE-GEOCODE ALL SHIFTS
===================================================== */

export const reGeocodeAllShifts = onCall(
  {
    region: 'europe-west2',
    timeoutSeconds: 540,
    memory: '1GiB',
  },
  async (req) => {
    await assertIsOwner(req.auth?.uid);

    if (!GEOCODING_KEY) {
      throw new HttpsError(
        'failed-precondition',
        'Missing GOOGLE_GEOCODING_KEY'
      );
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
      const url =
        `https://maps.googleapis.com/maps/api/geocode/json` +
        `?address=${address}&key=${GEOCODING_KEY}`;

      try {
        const res = await fetch(url);
        const json = (await res.json()) as {
          status: string;
          results?: Array<{
            geometry: {
              location: { lat: number; lng: number };
              location_type: string;
            };
          }>;
        };

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
            accuracy,
          },
        });

        updated++;
      } catch {
        failed++;
      }
    }

    return { updated, skipped, failed };
  }
);
