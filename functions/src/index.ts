
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import * as webPush from "web-push";

admin.initializeApp();
const db = admin.firestore();

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


// This is the v1 SDK syntax for Firestore triggers
export const sendShiftNotification = functions.region("europe-west2").firestore
    .document("shifts/{shiftId}")
    .onCreate(async (snapshot, context) => {
        const shiftId = context.params.shiftId;
        const shiftData = snapshot.data();
        
        functions.logger.log(`Function triggered for new shiftId: ${shiftId}`);

        const publicKey = functions.config().webpush?.public_key;
        const privateKey = functions.config().webpush?.private_key;

        if (!publicKey || !privateKey) {
            functions.logger.error("CRITICAL: VAPID keys are not configured. Run the command from the Admin Panel.");
            return null;
        }

        webPush.setVapidDetails(
            "mailto:example@your-project.com",
            publicKey,
            privateKey
        );
        
        const userId = shiftData?.userId;
        if (!userId) {
            functions.logger.warn(`Shift ${shiftId} has no userId.`);
            return null;
        }
        
        const payload = {
            title: "New Shift Assigned",
            body: `You have a new shift: ${shiftData?.task} at ${shiftData?.address}.`,
            data: { url: `/` },
        };

        functions.logger.log(`Preparing to send notification for userId: ${userId}`);

        const subscriptionsSnapshot = await db
            .collection("users")
            .doc(userId)
            .collection("pushSubscriptions")
            .get();

        if (subscriptionsSnapshot.empty) {
            functions.logger.warn(`User ${userId} has no push subscriptions.`);
            return null;
        }

        functions.logger.log(`Found ${subscriptionsSnapshot.size} subscriptions for user ${userId}.`);

        const sendPromises = subscriptionsSnapshot.docs.map((subDoc) => {
            const subscription = subDoc.data();
            return webPush.sendNotification(subscription, JSON.stringify(payload)).catch((error: any) => {
                functions.logger.error(`Error sending notification to user ${userId}:`, error);
                if (error.statusCode === 410 || error.statusCode === 404) {
                    functions.logger.log(`Deleting invalid subscription for user ${userId}.`);
                    return subDoc.ref.delete();
                }
                return null;
            });
        });

        await Promise.all(sendPromises);
        functions.logger.log(`Finished sending notifications for shift ${shiftId}.`);
        return null;
    });
