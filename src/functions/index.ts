
/* =====================================================
   IMPORTS
===================================================== */

import * as admin from "firebase-admin";
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { onDocumentCreated, onDocumentDeleted, onDocumentWritten } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";
import JSZip from "jszip";
import * as webPush from "web-push";

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
    webPush.setVapidDetails(
      "mailto:example@yourdomain.org",
      WEBPUSH_PUBLIC_KEY,
      WEBPUSH_PRIVATE_KEY
    );
  } catch (err) {
    logger.error("Failed to configure VAPID", err);
  }
} else {
  logger.warn("VAPID keys missing – push notifications disabled");
}

/* =====================================================
   HELPERS
===================================================== */

const assertIsOwner = async (uid: string) => {
  const snap = await db.collection("users").doc(uid).get();
  if (snap.data()?.role !== "owner") {
    throw new HttpsError("permission-denied", "Owner role required");
  }
};

const assertAdminOrManager = async (uid: string) => {
  const snap = await db.collection("users").doc(uid).get();
  const role = snap.data()?.role;
  if (!["admin", "owner", "manager"].includes(role)) {
    throw new HttpsError("permission-denied", "Insufficient permissions");
  }
};


const formatDateUK = (d: Date): string =>
  `${String(d.getUTCDate()).padStart(2, "0")}/${String(
    d.getUTCMonth() + 1
  ).padStart(2, "0")}/${d.getUTCFullYear()}`;

const isShiftInPast = (d: Date): boolean => {
  const now = new Date();
  const todayUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  );
  const shiftUtc = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate()
  );
  return shiftUtc < todayUtc;
};

const pendingGateUrl = () => "/dashboard?gate=pending";

/**
 * 🔒 CASE-INSENSITIVE NORMALIZATION
 */
const normalizeText = (text: string | null | undefined): string => {
  if (!text) return "";
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

/* =====================================================
   NOTIFICATIONS
===================================================== */

async function sendShiftNotification(
  userId: string,
  title: string,
  body: string,
  url: string,
  data: Record<string, any> = {}
): Promise<void> {
  if (!userId || !WEBPUSH_PUBLIC_KEY || !WEBPUSH_PRIVATE_KEY) return;

  const userDoc = await db.collection("users").doc(userId).get();
  if (userDoc.data()?.notificationsEnabled === false) return;

  const subs = await db
    .collection("users")
    .doc(userId)
    .collection("pushSubscriptions")
    .get();

  if (subs.empty) return;

  const payload = JSON.stringify({
    title,
    body,
    data: { url, ...data },
  });

  await Promise.all(
    subs.docs.map(async (doc) => {
      try {
        await webPush.sendNotification(
          doc.data() as webPush.PushSubscription,
          payload
        );
      } catch (err: any) {
        if ([404, 410].includes(err?.statusCode)) {
          await doc.ref.delete().catch(() => {});
        }
      }
    })
  );
}

/* =====================================================
   VAPID KEY (PUBLIC)
===================================================== */
export const getVapidPublicKey = onCall({ region: REGION }, () => {
    if (!WEBPUSH_PUBLIC_KEY) {
        throw new HttpsError("not-found", "VAPID public key not configured on server.");
    }
    return { publicKey: WEBPUSH_PUBLIC_KEY };
});

/* =====================================================
   CALLABLE FUNCTIONS
===================================================== */

export const getNotificationStatus = onCall({ region: REGION }, async (req) => {
  if (!req.auth?.uid) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  const snap = await db.collection("users").doc(req.auth.uid).get();
  return { enabled: snap.data()?.notificationsEnabled ?? false };
});

export const setNotificationStatus = onCall({ region: REGION }, async (req) => {
  if (!req.auth?.uid) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  
  const data = req.data;
  if (!data || typeof data !== "object") {
    throw new HttpsError("invalid-argument", "Request data must be an object.");
  }
  const enabled = (data as any).enabled;
  const subscription = (data as any).subscription;

  if (typeof enabled !== "boolean") {
    throw new HttpsError("invalid-argument", "enabled must be boolean");
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
   USER MANAGEMENT (CALLABLE)
===================================================== */

export const setUserStatus = onCall(
  { region: REGION },
  async (req) => {
    if (!req.auth?.uid) {
      throw new HttpsError("unauthenticated", "Authentication required");
    }
    await assertAdminOrManager(req.auth.uid);
    
    const data = req.data;
    if (!data || typeof data !== "object") {
        throw new HttpsError("invalid-argument", "Request data must be an object.");
    }
    const { uid, disabled, newStatus, department } = data as any;

    if (
      typeof uid !== 'string' ||
      typeof disabled !== 'boolean' ||
      !['active', 'suspended'].includes(newStatus)
    ) {
      throw new HttpsError('invalid-argument', 'Invalid input for user status update.');
    }

    const userUpdateData: { status: string; department?: string } = { status: newStatus };

    if (department && typeof department === 'string') {
      userUpdateData.department = department;
    }

    await admin.auth().updateUser(uid, { disabled });
    await db.collection('users').doc(uid).update(userUpdateData);

    return { success: true };
  }
);


export const deleteUser = onCall({ region: REGION }, async (req) => {
  if (!req.auth?.uid) {
    throw new HttpsError("unauthenticated", "Authentication required");
  }
  await assertIsOwner(req.auth.uid);

  const data = req.data;
  if (!data || typeof data !== "object") {
    throw new HttpsError("invalid-argument", "Request data must be an object.");
  }
  const uid = (data as any).uid;
  if (typeof uid !== 'string') {
    throw new HttpsError('invalid-argument', 'uid required');
  }

  await admin.auth().deleteUser(uid);
  await db.collection('users').doc(uid).delete();

  return { success: true };
});

/* =====================================================
   HTTP FILE SERVE
===================================================== */

export const serveFile = onRequest(
  { region: REGION, cors: true },
  async (req, res) => {
    const path = req.query.path as string;

    if (!path) {
      res.status(400).send("Missing path");
      return;
    }

    try {
        const file = admin.storage().bucket().file(path);
        const [exists] = await file.exists();

        if (!exists) {
          res.status(404).send("File not found");
          return;
        }

        const [metadata] = await file.getMetadata();
        const download = req.query.download === "1";

        res.setHeader("Content-Type", metadata.contentType || "application/octet-stream");
        res.setHeader(
          "Content-Disposition",
          `${download ? "attachment" : "inline"}; filename="${encodeURIComponent(metadata.name || "download")}"`
        );
        
        file.createReadStream().pipe(res);
    } catch(error) {
        logger.error("Error in serveFile:", error);
        res.status(500).send("Error serving file");
    }
  }
);

/* =====================================================
   FIRESTORE TRIGGERS
===================================================== */

export const onShiftCreated = onDocumentCreated(
  { document: "shifts/{shiftId}", region: REGION },
  async (event) => {
    const shift = event.data?.data();
    if (!shift?.userId) return;

    const date = shift.date?.toDate?.();
    if (!date || isShiftInPast(date)) return;

    await sendShiftNotification(
      shift.userId,
      "New shift added",
      `A new shift was added for ${formatDateUK(date)}`,
      pendingGateUrl(),
      { shiftId: event.params.shiftId }
    );
  }
);

export const syncUnavailabilityOnShiftWrite = onDocumentWritten(
  { document: "shifts/{shiftId}", region: REGION },
  async (event) => {
    const shiftId = event.params.shiftId;
    const shiftAfter = event.data?.after.data();

    if (!shiftAfter) return;

    const userRef = db.doc(`users/${shiftAfter.userId}`);
    const userSnap = await userRef.get();
    if (!userSnap.exists) return;

    const homeDepartment = userSnap.data()!.department;
    const shiftDepartment = shiftAfter.department;
    const unavailabilityRef = db.doc(`unavailability/${shiftId}`);

    if (!shiftDepartment || !homeDepartment || shiftDepartment === homeDepartment) {
      await unavailabilityRef.delete().catch(() => {});
      return;
    }

    await unavailabilityRef.set({
      userId: shiftAfter.userId,
      userName: shiftAfter.userName,
      startDate: shiftAfter.date,
      endDate: shiftAfter.date,
      reason: "Cross-Department Work",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      shiftId: shiftId,
    }, { merge: true });
  }
);

export const onShiftDeleted = onDocumentDeleted(
  { document: "shifts/{shiftId}", region: REGION },
  async (event) => {
    const shiftId = event.params.shiftId;
    await db.doc(`unavailability/${shiftId}`).delete().catch(() => {});
  }
);


/* =====================================================
   PROJECT & FILE MANAGEMENT (CALLABLE)
===================================================== */
export const deleteProjectAndFiles = onCall(
  { region: REGION, timeoutSeconds: 540, memory: '1GiB' },
  async (req) => {
    if (!req.auth?.uid) {
      throw new HttpsError("unauthenticated", "Authentication required");
    }
    await assertAdminOrManager(req.auth.uid);

    const data = req.data;
    if (!data || typeof data !== "object") {
        throw new HttpsError("invalid-argument", "Request data must be an object.");
    }
    const projectId = (data as any).projectId;
    if (typeof projectId !== 'string' || !projectId.trim()) {
      throw new HttpsError('invalid-argument', 'A projectId (string) is required.');
    }

    const bucket = admin.storage().bucket();
    const projectRef = db.collection('projects').doc(projectId);

    await bucket.deleteFiles({ prefix: `project_files/${projectId}/` }).catch(e => {
        console.warn(`Could not clean up storage for project ${projectId}.`, e);
    });

    const filesSnap = await projectRef.collection('files').get();
    if (!filesSnap.empty) {
        const batch = db.batch();
        filesSnap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
    }

    await projectRef.delete();
    return { success: true };
  }
);

export const deleteAllProjects = onCall({ region: REGION, timeoutSeconds: 540, memory: '1GiB' }, async (req) => {
    if (!req.auth?.uid) {
      throw new HttpsError("unauthenticated", "Authentication required");
    }
    await assertIsOwner(req.auth.uid);
    return { message: "Action complete." };
});

export const deleteProjectFile = onCall(
  { region: REGION },
  async (req) => {
    if (!req.auth?.uid) {
      throw new HttpsError("unauthenticated", "Authentication required");
    }
    const uid = req.auth.uid;
    const data = req.data;
    if (!data || typeof data !== "object") {
        throw new HttpsError("invalid-argument", "Request data must be an object.");
    }
    const { projectId, fileId } = data as any;
    if (!projectId || !fileId) {
      throw new HttpsError('invalid-argument', 'projectId and fileId required');
    }
    const userSnap = await db.collection('users').doc(uid).get();
    const role = userSnap.data()?.role;
    const fileRef = db.collection('projects').doc(projectId).collection('files').doc(fileId);
    const fileDoc = await fileRef.get();
    if (!fileDoc.exists) return { success: true };
    const fileData = fileDoc.data()!;
    if (uid !== fileData.uploaderId && !['admin', 'owner', 'manager'].includes(role)) {
      throw new HttpsError('permission-denied', 'Not allowed');
    }
    if (fileData.fullPath) {
      await admin.storage().bucket().file(fileData.fullPath).delete().catch(() => {});
    }
    await fileRef.delete();
    return { success: true };
  }
);

export const zipProjectFiles = onCall(
  { region: REGION, timeoutSeconds: 300, memory: '1GiB' },
  async (req) => {
    if (!req.auth?.uid) {
      throw new HttpsError("unauthenticated", "Authentication required");
    }
    const data = req.data;
    if (!data || typeof data !== "object") {
        throw new HttpsError("invalid-argument", "Request data must be an object.");
    }
    const projectId = (data as any).projectId;
    if (!projectId) {
      throw new HttpsError('invalid-argument', 'projectId required');
    }
    const projectDoc = await db.collection('projects').doc(projectId).get();
    if (!projectDoc.exists) {
      throw new HttpsError('not-found', 'Project not found');
    }
    const filesSnap = await projectDoc.ref.collection('files').get();
    if (filesSnap.empty) {
      throw new HttpsError('not-found', 'No files to zip.');
    }
    const zip = new JSZip();
    const bucket = admin.storage().bucket();
    await Promise.all(
      filesSnap.docs.map(async (doc) => {
        const fileData = doc.data();
        if (fileData.fullPath) {
          const [buf] = await bucket.file(fileData.fullPath).download();
          zip.file(fileData.name, buf);
        }
      })
    );
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const zipPath = `archives/${projectId}/${Date.now()}.zip`;
    const file = bucket.file(zipPath);
    await file.save(buffer, { contentType: 'application/zip' });
    const [downloadUrl] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 15 * 60 * 1000,
    });
    return { downloadUrl };
  }
);


/* =====================================================
   SHIFTS (CALLABLE)
===================================================== */
export const deleteShift = onCall({ region: REGION }, async (req) => {
  const uid = req.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Authentication required");
  }

  await assertAdminOrManager(uid);

  const data = req.data;
  if (!data || typeof data !== "object") {
    throw new HttpsError("invalid-argument", "Request data must be an object.");
  }

  const { shiftId } = data as { shiftId: string };
  if (typeof shiftId !== "string" || !shiftId.trim()) {
    throw new HttpsError("invalid-argument", "shiftId is required.");
  }

  const shiftRef = db.collection("shifts").doc(shiftId);
  await shiftRef.delete();

  return { success: true };
});

export const deleteAllShifts = onCall({ region: REGION }, async (req) => {
    if (!req.auth?.uid) {
      throw new HttpsError("unauthenticated", "Authentication required");
    }
    await assertIsOwner(req.auth.uid);
    const snap = await db.collection('shifts').get();
    if (snap.empty) return { message: "No shifts to delete." };

    const batch = db.batch();
    let count = 0;
    snap.docs.forEach((d) => {
      const status = d.data().status;
      if (!['completed', 'incomplete', 'rejected'].includes(status)) {
        batch.delete(d.ref);
        count++;
      }
    });

    await batch.commit();
    return { message: `Successfully deleted ${count} active shifts.` };
});

export const reGeocodeAllShifts = onCall({ region: REGION, timeoutSeconds: 540, memory: '1GiB' }, async (req) => {
    if (!req.auth?.uid) {
      throw new HttpsError("unauthenticated", "Authentication required");
    }
    await assertIsOwner(req.auth.uid);
    if (!GEOCODING_KEY) {
      throw new HttpsError('failed-precondition', 'Missing GEOCODING_KEY');
    }
    const snap = await db.collection('shifts').get();
    let updated = 0;
    for (const doc of snap.docs) {
      const addr = doc.data().address;
      if (!addr) continue;
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(addr + ', UK')}&key=${GEOCODING_KEY}`;
      const res = await fetch(url);
      const json = (await res.json()) as any;
      if (json.status === 'OK' && json.results?.length) {
        await doc.ref.update({ location: json.results[0].geometry.location });
        updated++;
      }
    }
    return { updated };
});

export const reconcileShifts = onCall({ region: REGION, timeoutSeconds: 300, memory: '1GiB' }, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) {
        throw new HttpsError("unauthenticated", "Authentication required");
    }
    await assertAdminOrManager(uid);

    const data = req.data;
    if (!data || typeof data !== "object") {
        throw new HttpsError("invalid-argument", "Request data must be an object.");
    }
    const { toCreate, toUpdate, toDelete, department } = data as any;

    if (!Array.isArray(toCreate) || !Array.isArray(toUpdate) || !Array.isArray(toDelete) || !department) {
        throw new HttpsError('invalid-argument', 'Invalid payload.');
    }

    const batch = db.batch();
    const projectsRef = db.collection('projects');
    const shiftsRef = db.collection('shifts');

    // --- Handle Project Creation/Update ---
    // 🔒 Fetch all projects for the department to perform case-insensitive matching
    const allProjectsSnap = await projectsRef.where('department', '==', department).get();
    const existingProjectsByAddr = new Map<string, any>();
    allProjectsSnap.forEach(d => {
        const p = d.data();
        existingProjectsByAddr.set(normalizeText(p.address), { ...p, id: d.id, ref: d.ref });
    });

    const allImportedShifts = [...toCreate, ...toUpdate.map((u: any) => u.new)];
    const projectInfoFromImport = new Map<string, any>();
    allImportedShifts.forEach((shift: any) => {
        if (shift.address) {
            projectInfoFromImport.set(normalizeText(shift.address), shift);
        }
    });

    const userSnap = await db.collection("users").doc(uid).get();
    const userProfile = userSnap.data();

    for (const [normAddr, shiftInfo] of projectInfoFromImport.entries()) {
        const existingProject = existingProjectsByAddr.get(normAddr);
        
        if (existingProject) {
            // Update contract if it changed (case-insensitive check)
            if (normalizeText(existingProject.contract) !== normalizeText(shiftInfo.contract)) {
                batch.update(existingProject.ref, { contract: shiftInfo.contract });
            }
        } else {
            // Create new project
            const reviewDate = new Date();
            reviewDate.setDate(reviewDate.getDate() + 28);
            batch.set(db.collection('projects').doc(), {
                address: shiftInfo.address,
                eNumber: shiftInfo.eNumber || '',
                manager: shiftInfo.manager || '',
                contract: shiftInfo.contract || '',
                department: shiftInfo.department || department || '',
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                createdBy: userProfile?.name || 'System Import',
                creatorId: uid,
                nextReviewDate: admin.firestore.Timestamp.fromDate(reviewDate),
            });
        }
    }

    // --- Handle Shift Creation ---
    toCreate.forEach((shift: any) => {
        const newShiftRef = shiftsRef.doc();
        batch.set(newShiftRef, {
            ...shift,
            date: admin.firestore.Timestamp.fromDate(new Date(shift.date)),
            status: 'pending-confirmation',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            source: 'import',
        });
    });

    // --- Handle Shift Updates ---
    toUpdate.forEach(({ id, new: newShift }: any) => {
        const updatePayload: any = {
            address: newShift.address,
            task: newShift.task,
            type: newShift.type,
            eNumber: newShift.eNumber || '',
            manager: newShift.manager || '',
            notes: newShift.notes || '',
            contract: newShift.contract || '',
            department: newShift.department || department || '',
            plannerName: newShift.plannerName || '',
        };
        
        // GAS ONLY: Do not reset status to 'pending-confirmation' if already accepted/active
        if (department !== 'Gas') {
            updatePayload.status = 'pending-confirmation';
        }
        
        batch.update(shiftsRef.doc(id), updatePayload);
    });

    // --- Handle Shift Deletions ---
    toDelete.forEach((shift: any) => {
        batch.delete(shiftsRef.doc(shift.id));
    });

    await batch.commit();
    
    return {
        success: true,
        message: `Processed: ${toCreate.length} created, ${toUpdate.length} updated, ${toDelete.length} deleted.`
    };
});


/* =====================================================
   SCHEDULED FUNCTIONS
===================================================== */

export const projectReviewNotifier = onSchedule(
  { schedule: "every 24 hours", region: REGION },
  async (event) => {
    logger.info("projectReviewNotifier ran");
  }
);

export const pendingShiftNotifier = onSchedule(
  { schedule: "every 1 hours", region: REGION },
  async (event) => {
    logger.info("pendingShiftNotifier ran");
  }
);

export const deleteScheduledProjects = onSchedule(
  {
    schedule: "every day 01:00",
    region: REGION,
    timeoutSeconds: 540,
    memory: "256MiB",
  },
  async (event) => {
    logger.info("Scheduled project cleanup started");
  }
);
