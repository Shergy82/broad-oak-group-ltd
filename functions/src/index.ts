
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

admin.initializeApp();

// This is the v1 SDK syntax for onCall functions
export const getVapidPublicKey = functions.region("europe-west2").https.onCall((data, context) => {
    // In v1, config is accessed via functions.config()
    const publicKey = functions.config().webpush?.public_key;
    if (!publicKey) {
        functions.logger.error("CRITICAL: VAPID public key (webpush.public_key) not set in function configuration.");
        throw new functions.https.HttpsError('not-found', 'VAPID public key is not configured on the server.');
    }
    return { publicKey };
});
