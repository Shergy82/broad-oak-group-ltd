

/* =====================================================
   IMPORTS
===================================================== */

import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
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

const assertAuthenticated = (uid?: string) => {
  if (!uid) throw new HttpsError("unauthenticated", "Authentication required");
};

const assertIsOwner = async (uid?: string) => {
  assertAuthenticated(uid);
  const snap = await db.collection("users").doc(uid!).get();
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
  assertAuthenticated(req.auth?.uid);
  const snap = await db.collection("users").doc(req.auth!.uid).get();
  return { enabled: snap.data()?.notificationsEnabled ?? false };
});

export const setNotificationStatus = onCall({ region: REGION }, async (req) => {
  assertAuthenticated(req.auth?.uid);
  const { enabled, subscription } = req.data ?? {};

  if (typeof enabled !== "boolean") {
    throw new HttpsError("invalid-argument", "enabled must be boolean");
  }

  await db
    .collection("users")
    .doc(req.auth!.uid)
    .set({ notificationsEnabled: enabled }, { merge: true });

  if (enabled && subscription) {
    await db
      .collection("users")
      .doc(req.auth!.uid)
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
    await assertAdminOrManager(req.auth!.uid);

    const { uid, disabled, newStatus, department } = req.data ?? {};
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
  await assertIsOwner(req.auth?.uid);

  const { uid } = req.data ?? {};
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

    const file = admin.storage().bucket().file(path);
    const [exists] = await file.exists();

    if (!exists) {
      res.status(404).send("Not found");
      return;
    }

    file.createReadStream().pipe(res);
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


/* =====================================================
   PROJECT & FILE MANAGEMENT (CALLABLE)
===================================================== */
export const deleteProjectAndFiles = onCall(
  { region: REGION, timeoutSeconds: 540, memory: '1GiB' },
  async (req) => {
    await assertAdminOrManager(req.auth!.uid);

    const { projectId } = req.data as { projectId: string };
    if (!projectId) {
      throw new HttpsError('invalid-argument', 'projectId is required');
    }

    const bucket = admin.storage().bucket();
    const projectRef = db.collection('projects').doc(projectId);

    await bucket.deleteFiles({ prefix: `project_files/${projectId}/` }).catch(e => {
        console.warn(`Could not clean up storage for project ${projectId}, but proceeding with Firestore deletion.`, e);
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
    await assertIsOwner(req.auth!.uid);
    // This is a placeholder for safety. In a real scenario, you'd iterate and delete.
    logger.info("deleteAllProjects called by", req.auth?.uid);
    return { message: "Deletion process simulation complete. No projects were actually deleted." };
});

export const deleteProjectFile = onCall(
  { region: REGION },
  async (req) => {
    assertAuthenticated(req.auth?.uid);
    const uid = req.auth!.uid;
    const { projectId, fileId } = req.data ?? {};
    if (!projectId || !fileId) {
      throw new HttpsError('invalid-argument', 'projectId and fileId required');
    }
    const userSnap = await db.collection('users').doc(uid).get();
    const role = userSnap.data()?.role;
    const fileRef = db.collection('projects').doc(projectId).collection('files').doc(fileId);
    const fileDoc = await fileRef.get();
    if (!fileDoc.exists) return { success: true };
    const data = fileDoc.data()!;
    if (uid !== data.uploaderId && !['admin', 'owner', 'manager'].includes(role)) {
      throw new HttpsError('permission-denied', 'Not allowed');
    }
    if (data.fullPath) {
      await admin.storage().bucket().file(data.fullPath).delete().catch(() => {});
    }
    await fileRef.delete();
    return { success: true };
  }
);

export const zipProjectFiles = onCall(
  { region: REGION, timeoutSeconds: 300, memory: '1GiB' },
  async (req) => {
    assertAuthenticated(req.auth?.uid);
    const { projectId } = req.data ?? {};
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
        const data = doc.data();
        if (data.fullPath) {
          const [buf] = await bucket.file(data.fullPath).download();
          zip.file(data.name, buf);
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
export const deleteAllShifts = onCall({ region: REGION }, async (req) => {
    await assertIsOwner(req.auth?.uid);
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

export const deleteAllShiftsForUser = onCall({ region: REGION, timeoutSeconds: 540, memory: "1GiB" }, async (req) => {
    await assertIsOwner(req.auth?.uid);
    const { userId } = req.data as { userId: string };

    if (!userId) {
        throw new HttpsError('invalid-argument', 'A userId is required.');
    }

    const shiftsRef = db.collection('shifts');
    let query = shiftsRef.where('userId', '==', userId).orderBy("__name__").limit(400);
    let totalDeleted = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
        logger.info(`Getting next batch for user ${userId}...`);
        const snapshot = await query.get();
        
        if (snapshot.empty) {
            logger.info("Snapshot is empty, finishing deletion.");
            break;
        }

        logger.info(`Found ${snapshot.size} shifts to delete.`);
        const batch = db.batch();
        snapshot.docs.forEach((doc) => {
            batch.delete(doc.ref);
        });
        
        logger.info("Committing batch delete...");
        await batch.commit();
        
        totalDeleted += snapshot.size;
        logger.info(`Deleted ${snapshot.size} shifts for user ${userId}. Total deleted so far: ${totalDeleted}`);
        
        if (snapshot.size < 400) {
            logger.info("Last batch was smaller than limit, finishing deletion.");
            break;
        }

        const lastVisible = snapshot.docs[snapshot.docs.length - 1];
        logger.info(`Paginating after doc ID: ${lastVisible.id}`);
        query = shiftsRef.where('userId', '==', userId).orderBy("__name__").startAfter(lastVisible).limit(400);
    }

    if (totalDeleted === 0) {
        return { message: "No shifts found for this user to delete." };
    }

    return { message: `Successfully deleted ${totalDeleted} shifts for the user.` };
});


export const reGeocodeAllShifts = onCall({ region: REGION, timeoutSeconds: 540, memory: '1GiB' }, async (req) => {
    await assertIsOwner(req.auth?.uid);
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
      const json = (await res.json()) as { status: string; results?: Array<{ geometry: { location: { lat: number; lng: number } } }>; };
      if (json.status === 'OK' && json.results?.length) {
        await doc.ref.update({ location: json.results[0].geometry.location });
        updated++;
      }
    }
    return { updated };
});


/* =====================================================
   SCHEDULED FUNCTIONS (FIXED)
===================================================== */

export const projectReviewNotifier = onSchedule(
  { schedule: "every 24 hours", region: REGION },
  async (event) => {
    logger.info("projectReviewNotifier ran", {
      scheduleTime: event.scheduleTime,
    });
  }
);

export const pendingShiftNotifier = onSchedule(
  { schedule: "every 1 hours", region: REGION },
  async (event) => {
    logger.info("pendingShiftNotifier ran", {
      scheduleTime: event.scheduleTime,
    });
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
    logger.info("Scheduled project cleanup started", {
      scheduleTime: event.scheduleTime,
    });
    // Placeholder for actual deletion logic
    logger.info("Scheduled project cleanup finished");
  }
);
