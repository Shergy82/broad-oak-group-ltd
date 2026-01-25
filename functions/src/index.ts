import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import admin from "firebase-admin";

if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();
const europeWest2 = "europe-west2";

function createSafeDocId(input: string): string {
    return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export const setNotificationStatus = onCall({ region: europeWest2, cors: true }, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) {
        logger.error("setNotificationStatus called without authentication.");
        throw new HttpsError("unauthenticated", "You must be logged in to modify notification settings.");
    }

    const { enabled, token } = req.data;
    const cleanToken = typeof token === 'string' ? token.trim() : '';

    try {
        const userRef = db.collection("users").doc(uid);
        const pushTokensCollection = userRef.collection("pushTokens");

        await userRef.set({ notificationsEnabled: !!enabled }, { merge: true });

        if (enabled) {
            if (!cleanToken) {
                throw new HttpsError("invalid-argument", "A valid token is required to subscribe.");
            }
            const docId = createSafeDocId(cleanToken);
            await pushTokensCollection.doc(docId).set({
                token: cleanToken,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
            logger.info(`User ${uid} subscribed.`);
            return { success: true, message: "Subscribed successfully." };
        } else {
            // Unsubscribe
            if (cleanToken) {
                const docId = createSafeDocId(cleanToken);
                await pushTokensCollection.doc(docId).delete().catch(() => {});
                logger.info(`User ${uid} unsubscribed a specific token.`);
            } else {
                const snapshot = await pushTokensCollection.get();
                if (!snapshot.empty) {
                    const batch = db.batch();
                    snapshot.docs.forEach(doc => batch.delete(doc.ref));
                    await batch.commit();
                }
                logger.info(`User ${uid} unsubscribed all tokens.`);
            }
            return { success: true, message: "Unsubscribed successfully." };
        }
    } catch (error: any) {
        logger.error("Error in setNotificationStatus:", { uid, message: error.message });
        throw new HttpsError("internal", "An unexpected error occurred.");
    }
});

// Stub for getVapidPublicKey to ensure function exists if called.
export const getVapidPublicKey = onCall({ region: europeWest2, cors: true }, () => {
    logger.info("getVapidPublicKey called, returning key from environment variables.");
    return { publicKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY || "" };
});
