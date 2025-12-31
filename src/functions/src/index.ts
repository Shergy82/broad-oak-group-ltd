import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { admin, setupVapid, notificationsEnabled, webPush } from "./firebase-functions";
import JSZip = require("jszip");
import { logger } from "firebase-functions/v2";

// Firestore reference
const db = admin.firestore();

// Push subscription converter
const pushSubscriptionConverter = {
  toFirestore(subscription: webPush.PushSubscription) {
    return { endpoint: subscription.endpoint, keys: subscription.keys };
  },
  fromFirestore(snapshot: FirebaseFirestore.QueryDocumentSnapshot) {
    const data = snapshot.data();
    if (!data.endpoint || !data.keys || !data.keys.p256dh || !data.keys.auth) {
      throw new Error("Invalid PushSubscription data from Firestore.");
    }
    return {
      endpoint: data.endpoint,
      keys: { p256dh: data.keys.p256dh, auth: data.keys.auth },
    };
  },
};

const europeWest2 = "europe-west2";

// ------------------ Callable functions ------------------

// Get VAPID public key
export const getVapidPublicKey = onCall({ region: europeWest2 }, (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "You must be logged in.");
  setupVapid();
  return { publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY };
});

// Get global notification status (owner only)
export const getNotificationStatus = onCall({ region: europeWest2 }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "You must be logged in.");
  const userDoc = await db.collection("users").doc(request.auth.uid).get();
  if (userDoc.data()?.role !== "owner") throw new HttpsError("permission-denied", "Only owner can view settings.");
  const settingsDoc = await db.collection("settings").doc("notifications").get();
  return { enabled: settingsDoc.exists && settingsDoc.data()?.enabled !== false };
});

// Set global notification status (owner only)
export const setNotificationStatus = onCall({ region: europeWest2 }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "You must be logged in.");
  const userDoc = await db.collection("users").doc(request.auth.uid).get();
  if (userDoc.data()?.role !== "owner") throw new HttpsError("permission-denied", "Only owner can change settings.");
  if (typeof request.data.enabled !== "boolean") throw new HttpsError("invalid-argument", "'enabled' must be boolean.");

  await db.collection("settings").doc("notifications").set({ enabled: request.data.enabled }, { merge: true });
  logger.log(`Owner ${request.auth.uid} set global notifications to: ${request.data.enabled}`);
  return { success: true };
});

// ------------------ Firestore triggers ------------------

// Send push notification when a shift is created, updated, or deleted
export const sendShiftNotification = onDocumentWritten(
  { document: "shifts/{shiftId}", region: europeWest2 },
  async (event) => {
    if (!(await notificationsEnabled())) return;

    setupVapid();

    const beforeData = event.data?.before.data();
    const afterData = event.data?.after.data();

    let userId: string | null = null;
    let payload: object | null = null;

    // New shift
    if (event.data?.after.exists && !event.data?.before.exists && afterData) {
      userId = afterData.userId;
      payload = { title: "New Shift Assigned", body: `You have a new shift: ${afterData.task} at ${afterData.address}.`, data: { url: "/dashboard" } };
    }
    // Shift deleted
    else if (event.data?.before.exists && !event.data?.after.exists && beforeData) {
      userId = beforeData.userId;
      payload = { title: "Shift Cancelled", body: `Your shift for ${beforeData.task} at ${beforeData.address} has been cancelled.`, data: { url: "/dashboard" } };
    }
    // Shift updated
    else if (event.data?.before.exists && event.data?.after.exists && beforeData && afterData) {
      const changedFields: string[] = [];
      if ((beforeData.task || "").trim() !== (afterData.task || "").trim()) changedFields.push("task");
      if ((beforeData.address || "").trim() !== (afterData.address || "").trim()) changedFields.push("location");
      if ((beforeData.eNumber || "").trim() !== (afterData.eNumber || "").trim()) changedFields.push("E Number");
      if (beforeData.type !== afterData.type) changedFields.push("time (AM/PM)");
      if (beforeData.date && afterData.date && !beforeData.date.isEqual(afterData.date)) changedFields.push("date");

      if (changedFields.length > 0) {
        userId = afterData.userId;
        payload = { title: "Your Shift Has Been Updated", body: `The ${changedFields.join(" & ")} for one of your shifts has been updated.`, data: { url: "/dashboard" } };
      } else return;
    } else return;

    if (!userId || !payload) return;

    const subscriptionsSnapshot = await db.collection("users").doc(userId).collection("pushSubscriptions").withConverter(pushSubscriptionConverter).get();
    if (subscriptionsSnapshot.empty) return;

    const sendPromises = subscriptionsSnapshot.docs.map((subDoc) => {
      const subscription = subDoc.data();
      return webPush.sendNotification(subscription, JSON.stringify(payload)).catch((error: any) => {
        if (error.statusCode === 410 || error.statusCode === 404) return subDoc.ref.delete();
        logger.error(`Error sending notification to user ${userId}:`, error);
        return null;
      });
    });
    await Promise.all(sendPromises);
  }
);

// ------------------ Scheduled functions ------------------

// Daily project review notifier
export const projectReviewNotifier = onSchedule({ schedule: "every 24 hours", region: europeWest2 }, async () => {
  if (!(await notificationsEnabled())) return;
  setupVapid();

  const now = admin.firestore.Timestamp.now();
  const projectsSnap = await db.collection("projects").where("nextReviewDate", "<=", now).get();
  if (projectsSnap.empty) return;

  const batch = db.batch();
  for (const projectDoc of projectsSnap.docs) {
    const projectData = projectDoc.data();
    const { creatorId, address } = projectData;
    if (!creatorId) continue;

    const payload = JSON.stringify({ title: "Project Review Reminder", body: `It's time to review the project at ${address}.`, data: { url: "/projects" } });
    const subscriptionsSnap = await db.collection("users").doc(creatorId).collection("pushSubscriptions").withConverter(pushSubscriptionConverter).get();

    const sendPromises = subscriptionsSnap.docs.map((subDoc) => webPush.sendNotification(subDoc.data(), payload).catch((err: any) => {
      if (err.statusCode === 410 || err.statusCode === 404) return subDoc.ref.delete();
      logger.error(err);
      return null;
    }));

    await Promise.all(sendPromises);
    const newDate = new Date();
    newDate.setDate(newDate.getDate() + 28);
    batch.update(projectDoc.ref, { nextReviewDate: admin.firestore.Timestamp.fromDate(newDate) });
  }
  await batch.commit();
});

// Hourly pending shift notifier
export const pendingShiftNotifier = onSchedule({ schedule: "every 1 hours", region: europeWest2 }, async () => {
  if (!(await notificationsEnabled())) return;
  setupVapid();

  const pendingShiftsSnap = await db.collection("shifts").where("status", "==", "pending-confirmation").get();
  if (pendingShiftsSnap.empty) return;

  const shiftsByUser = new Map<string, any[]>();
  pendingShiftsSnap.docs.forEach((doc) => {
    const shift = doc.data();
    if (shift.userId) {
      if (!shiftsByUser.has(shift.userId)) shiftsByUser.set(shift.userId, []);
      shiftsByUser.get(shift.userId)!.push(shift);
    }
  });

  for (const [userId, userShifts] of shiftsByUser.entries()) {
    const subsSnap = await db.collection("users").doc(userId).collection("pushSubscriptions").withConverter(pushSubscriptionConverter).get();
    if (subsSnap.empty) continue;

    const payload = JSON.stringify({ title: "Pending Shifts Reminder", body: `You have ${userShifts.length} shift(s) awaiting your confirmation.`, data: { url: "/dashboard" } });
    const sendPromises = subsSnap.docs.map((subDoc) => webPush.sendNotification(subDoc.data(), payload).catch((err: any) => {
      if (err.statusCode === 410 || err.statusCode === 404) return subDoc.ref.delete();
      logger.error(err);
      return null;
    }));
    await Promise.all(sendPromises);
  }
});

// ------------------ File & Project management ------------------

// Delete a project and all associated files
export const deleteProjectAndFiles = onCall({ region: europeWest2 }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const userDoc = await db.collection("users").doc(request.auth.uid).get();
  if (!["admin", "owner", "manager"].includes(userDoc.data()?.role)) throw new HttpsError("permission-denied", "No permission.");

  const projectId = request.data.projectId;
  if (!projectId) throw new HttpsError("invalid-argument", "Project ID is required.");

  const bucket = admin.storage().bucket();
  await bucket.deleteFiles({ prefix: `project_files/${projectId}/` });

  const projectRef = db.collection("projects").doc(projectId);
  const filesSnap = await projectRef.collection("files").get();
  const batch = db.batch();
  filesSnap.forEach((doc) => batch.delete(doc.ref));
  batch.delete(projectRef);
  await batch.commit();

  return { success: true, message: `Project ${projectId} deleted successfully.` };
});

// ------------------ Zip project files ------------------
export const zipProjectFiles = onCall({ region: europeWest2, timeoutSeconds: 300, memory: "1GiB" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Login required.");
  const projectId = request.data?.projectId;
  if (!projectId) throw new HttpsError("invalid-argument", "projectId required.");

  setupVapid();
  const bucket = admin.storage().bucket();
  const zip = new JSZip();

  const filesSnap = await db.collection("projects").doc(projectId).collection("files").get();
  if (filesSnap.empty) throw new HttpsError("not-found", "No files to zip.");

  for (const doc of filesSnap.docs) {
    const data = doc.data();
    if (!data.fullPath || !data.name) continue;
    const [buffer] = await bucket.file(data.fullPath).download();
    zip.file(data.name, buffer);
  }

  const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
  const zipPath = `temp_zips/project_${projectId}_${Date.now()}.zip`;
  const zipFile = bucket.file(zipPath);

  await zipFile.save(zipBuffer, { contentType: "application/zip", resumable: false });
  const [url] = await zipFile.getSignedUrl({ action: "read", expires: Date.now() + 15 * 60 * 1000, version: "v4" });

  return { downloadUrl: url };
});
