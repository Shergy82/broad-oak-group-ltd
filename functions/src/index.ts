
import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();

/* =====================================================
   NOTIFICATION STATUS (REQUIRED BY FRONTEND)
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

    const enabled = req.data?.enabled === true;
    if (typeof enabled !== 'boolean') {
      throw new HttpsError('invalid-argument', 'enabled must be boolean');
    }

    await db
      .collection('users')
      .doc(req.auth.uid)
      .set({ notificationsEnabled: enabled }, { merge: true });

    return { success: true };
  }
);

/* =====================================================
   USER MANAGEMENT (OWNER ONLY)
===================================================== */

/**
 * Checks if the calling user has the 'owner' role. Throws an HttpsError if not.
 */
const assertIsOwner = async (uid: string | undefined) => {
    if (!uid) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }
    const userDoc = await db.collection('users').doc(uid).get();
    const userRole = userDoc.data()?.role;
    if (userRole !== 'owner') {
        throw new HttpsError('permission-denied', 'You must be an owner to perform this action.');
    }
};

export const setUserStatus = onCall(
  { region: 'europe-west2' },
  async (req) => {
    await assertIsOwner(req.auth?.uid);
    
    const { uid, disabled, newStatus } = req.data;
    if (typeof uid !== 'string' || typeof disabled !== 'boolean' || (newStatus !== 'active' && newStatus !== 'suspended')) {
        throw new HttpsError('invalid-argument', 'The function must be called with a `uid`, `disabled` state, and `newStatus`.');
    }

    try {
        // Update Firebase Auth state
        await admin.auth().updateUser(uid, { disabled });

        // Update Firestore document status
        const userDocRef = db.collection('users').doc(uid);
        await userDocRef.update({ status: newStatus });
        
        return { success: true, message: `User ${uid} status updated to ${newStatus}.` };
    } catch (error: any) {
        console.error("Error updating user status:", error);
        throw new HttpsError('internal', error.message || 'An unknown error occurred while updating user status.');
    }
  }
);


export const deleteUser = onCall(
    { region: 'europe-west2' },
    async (req) => {
        await assertIsOwner(req.auth?.uid);
        
        const { uid } = req.data;
        if (typeof uid !== 'string') {
            throw new HttpsError('invalid-argument', 'The function must be called with a user `uid`.');
        }

        try {
            // Delete from Firebase Auth
            await admin.auth().deleteUser(uid);
            
            // Delete from Firestore
            await db.collection('users').doc(uid).delete();

            return { success: true, message: `User ${uid} has been deleted.` };
        } catch (error: any) {
            console.error("Error deleting user:", error);
            throw new HttpsError('internal', error.message || 'An unknown error occurred while deleting the user.');
        }
    }
);
