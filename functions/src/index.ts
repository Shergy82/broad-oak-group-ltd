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
   BOOTSTRAP
===================================================== */

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();
const REGION = "europe-west2";

/* =====================================================
   HELPERS
===================================================== */

const assertAdminOrManager = async (uid: string) => {
  const snap = await db.collection("users").doc(uid).get();
  const role = snap.data()?.role;
  if (!["admin", "owner", "manager", "TLO"].includes(role)) {
    throw new HttpsError("permission-denied", "Insufficient permissions for this action.");
  }
};

const normalizeText = (text: string | null | undefined): string => {
  if (!text) return "";
  return String(text)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

/* =====================================================
   SHIFT RECONCILIATION (SYNC ENGINE)
===================================================== */

export const reconcileShifts = onCall({ region: REGION, timeoutSeconds: 300, memory: '1GiB' }, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Authentication required");
    await assertAdminOrManager(uid);

    const data = req.data as any;
    const { 
        toCreate = [], 
        toUpdate = [], 
        toDelete = [], 
        department,
        profileId,
        profileName
    } = data;

    if (!department) throw new HttpsError('invalid-argument', 'Missing department.');
    if (!profileId) throw new HttpsError('invalid-argument', 'Missing planner identity.');

    const batch = db.batch();
    const shiftsRef = db.collection('shifts');
    const projectsRef = db.collection('projects');

    // 1. Sync Projects
    const allProjectsSnap = await projectsRef.where('department', '==', department).get();
    const existingProjects = new Map();
    allProjectsSnap.forEach(d => existingProjects.set(normalizeText(d.data().address), d.ref));

    const allImportedShifts = [...toCreate, ...toUpdate.map((u: any) => u.new)];
    const uniqueIncomingSites = new Map();
    allImportedShifts.forEach((s: any) => { if (s.address) uniqueIncomingSites.set(normalizeText(s.address), s); });

    for (const [normAddr, info] of uniqueIncomingSites.entries()) {
        if (!existingProjects.has(normAddr)) {
            const reviewDate = new Date();
            reviewDate.setDate(reviewDate.getDate() + 28);
            batch.set(projectsRef.doc(), {
                address: info.address,
                eNumber: info.eNumber || '',
                manager: info.manager || '',
                contract: info.contract || '',
                department: department,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                creatorId: uid,
                nextReviewDate: admin.firestore.Timestamp.fromDate(reviewDate),
            });
        }
    }

    // 2. Create Shifts
    toCreate.forEach((s: any) => {
        batch.set(shiftsRef.doc(), {
            userId: s.operativeUid || s.userId, 
            userName: s.operative,
            operativeUid: s.operativeUid || s.userId,
            address: s.address,
            task: s.task,
            date: admin.firestore.Timestamp.fromDate(new Date(s.date)),
            dateKey: s.dateKey,
            type: s.type || 'all-day',
            startTime: s.startTime || '',
            endTime: s.endTime || '',
            eNumber: s.eNumber || '',
            contract: s.contract || '',
            manager: s.manager || '',
            department: department,
            status: 'pending-confirmation', 
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            source: 'import',
            sourcePlannerId: s.sourcePlannerId || profileId,
            sourcePlannerName: s.sourcePlannerName || profileName,
            plannerName: s.plannerName || profileName,
            profileId: s.profileId || profileId,
            importKey: s.importKey,
            sourceSheet: s.sourceSheet || '',
            sourceCell: s.sourceCell || '',
            descriptionOfWorks: s.descriptionOfWorks || '',
            room: s.room || ''
        });
    });

    // 3. Update & Backfill Shifts
    toUpdate.forEach(({ id, new: n }: any) => {
        batch.update(shiftsRef.doc(id), {
            userId: n.operativeUid || n.userId,
            userName: n.operative,
            operativeUid: n.operativeUid || n.userId,
            address: n.address,
            task: n.task,
            date: admin.firestore.Timestamp.fromDate(new Date(n.date)),
            dateKey: n.dateKey,
            type: n.type || 'all-day',
            startTime: n.startTime || '',
            endTime: n.endTime || '',
            eNumber: n.eNumber || '',
            contract: n.contract || '',
            manager: n.manager || '',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            sourcePlannerId: n.sourcePlannerId || profileId,
            sourcePlannerName: n.sourcePlannerName || profileName,
            plannerName: n.plannerName || profileName,
            profileId: n.profileId || profileId,
            importKey: n.importKey,
            sourceSheet: n.sourceSheet || '',
            sourceCell: n.sourceCell || '',
            descriptionOfWorks: n.descriptionOfWorks || '',
            room: n.room || ''
        });
    });

    // 4. Delete Shifts
    toDelete.forEach((s: any) => { 
        if (s.id) {
            batch.delete(shiftsRef.doc(s.id)); 
        }
    });

    await batch.commit();
    return { 
        success: true,
        message: `Schedule Sync Complete: ${toCreate.length} created, ${toUpdate.length} updated/backfilled, ${toDelete.length} removed.`
    };
});

export const serveFile = onRequest({ region: REGION, cors: true }, async (req, res) => {
    const path = req.query.path as string;
    if (!path) { res.status(400).send("Missing path"); return; }
    try {
        const file = admin.storage().bucket().file(path);
        const [exists] = await file.exists();
        if (!exists) { res.status(404).send("Not found"); return; }
        file.createReadStream().pipe(res);
    } catch(error) { res.status(500).send("Error serving file"); }
});

export const deleteUser = onCall({ region: REGION }, async (req) => {
  const data = req.data as any;
  if (!req.auth?.uid) throw new HttpsError("unauthenticated", "Auth required");
  await admin.auth().deleteUser(data.uid);
  await db.collection('users').doc(data.uid).delete();
  return { success: true };
});

export const setUserStatus = onCall({ region: REGION }, async (req) => {
    const data = req.data as any;
    const { uid, disabled, newStatus, department } = data;
    await admin.auth().updateUser(uid, { disabled: disabled });
    await db.collection('users').doc(uid).update({ status: newStatus, department: department || '' });
    return { success: true };
});

export const getVapidPublicKey = onCall({ region: REGION }, () => {
    return { publicKey: process.env.WEBPUSH_PUBLIC_KEY || "" };
});
