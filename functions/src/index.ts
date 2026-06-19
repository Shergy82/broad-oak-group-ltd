/* =====================================================
   IMPORTS
===================================================== */

import * as admin from "firebase-admin";
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";

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

function formatDateKey(value: any): string {
  if (!value) return "";
  const d = value instanceof Date ? value : value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getTodayDateKey(): string {
  return formatDateKey(new Date());
}

function isHistoricShift(shift: any): boolean {
  const key = shift?.dateKey || formatDateKey(shift?.date);
  if (!key) return false;
  return key < getTodayDateKey();
}

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
    
    const batch = db.batch();
    const shiftsRef = db.collection('shifts');
    const projectsRef = db.collection('projects');

    // 1. Sync Projects (Silently skip historic sites)
    const allProjectsSnap = await projectsRef.where('department', '==', department).get();
    const existingProjects = new Map();
    allProjectsSnap.forEach(d => existingProjects.set(normalizeText(d.data().address), d.ref));

    const allImportedShifts = [...toCreate, ...toUpdate.map((u: any) => u.new)];
    const uniqueIncomingSites = new Map();
    allImportedShifts.forEach((s: any) => { 
        if (s.address && !isHistoricShift(s)) {
            uniqueIncomingSites.set(normalizeText(s.address), s); 
        }
    });

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

    // 2. Create Shifts (Silent Historic Skip)
    toCreate.forEach((s: any) => {
        if (isHistoricShift(s)) return;

        const dateKey = s.dateKey || formatDateKey(s.date);
        
        const shiftPayload = {
            address: s.address || "",
            contract: s.contract || "",
            department: s.department || department || "",
            eNumber: s.eNumber || "",
            manager: s.manager || "",

            operativeUid: s.operativeUid || s.userId || "",
            operative: s.operative || s.userName || "",
            userId: s.userId || s.operativeUid || "",
            userName: s.userName || s.operative || "",

            date: admin.firestore.Timestamp.fromDate(new Date(s.date)),
            dateKey: dateKey,

            type: s.type || "all-day",
            startTime: s.startTime || "",
            endTime: s.endTime || "",

            task: s.task || "",
            descriptionOfWorks: s.descriptionOfWorks || "",

            room: s.room || "",

            source: "import",
            sourcePlannerId: s.sourcePlannerId || profileId || "",
            sourcePlannerName: s.sourcePlannerName || s.sourcePlannerId || profileName || "",
            plannerName: s.plannerName || s.sourcePlannerName || profileName || "",
            profileId: s.profileId || s.sourcePlannerId || profileId || "",

            importKey: s.importKey || "",

            sourceSheet: s.sourceSheet || "",
            sourceCell: s.sourceCell || "",

            status: s.status || 'pending-confirmation',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        logger.info("SHIFT_IMPORT_WRITE_PAYLOAD", shiftPayload);
        batch.set(shiftsRef.doc(), shiftPayload);
    });

    // 3. Update Shifts (Silent Historic Skip)
    toUpdate.forEach(({ id, new: n }: any) => {
        if (isHistoricShift(n)) return;

        const dateKey = n.dateKey || formatDateKey(n.date);

        const shiftUpdatePayload = {
            address: n.address || "",
            contract: n.contract || "",
            department: n.department || department || "",
            eNumber: n.eNumber || "",
            manager: n.manager || "",

            operativeUid: n.operativeUid || n.userId || "",
            operative: n.operative || n.userName || "",
            userId: n.userId || n.operativeUid || "",
            userName: n.userName || n.operative || "",

            date: admin.firestore.Timestamp.fromDate(new Date(n.date)),
            dateKey: dateKey,

            type: n.type || "all-day",
            startTime: n.startTime || "",
            endTime: n.endTime || "",

            task: n.task || "",
            descriptionOfWorks: n.descriptionOfWorks || "",

            room: n.room || "",

            source: "import",
            sourcePlannerId: n.sourcePlannerId || profileId || "",
            sourcePlannerName: n.sourcePlannerName || n.sourcePlannerId || profileName || "",
            plannerName: n.plannerName || n.sourcePlannerName || profileName || "",
            profileId: n.profileId || n.sourcePlannerId || profileId || "",

            importKey: n.importKey || "",

            sourceSheet: n.sourceSheet || "",
            sourceCell: n.sourceCell || "",

            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        logger.info("SHIFT_IMPORT_WRITE_PAYLOAD", { id, ...shiftUpdatePayload });
        batch.update(shiftsRef.doc(id), shiftUpdatePayload);
    });

    // 4. Delete Shifts (Silent Historic Skip Safety)
    toDelete.forEach((s: any) => { 
        if (s.id && !isHistoricShift(s)) {
            batch.delete(shiftsRef.doc(s.id)); 
        }
    });

    await batch.commit();
    return { 
        success: true,
        message: `Sync Complete: ${toCreate.length} created, ${toUpdate.length} updated, ${toDelete.length} removed.`
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
