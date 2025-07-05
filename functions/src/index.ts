
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import * as webPush from "web-push";

admin.initializeApp();
const db = admin.firestore();

// Define a converter for the PushSubscription type.
// This is the modern, correct way to handle typed data with Firestore.
// It ensures that when we fetch data, it's already in the correct shape.
const pushSubscriptionConverter = {
    toFirestore(subscription: webPush.PushSubscription): admin.firestore.DocumentData {
        return { endpoint: subscription.endpoint, keys: subscription.keys };
    },
    fromFirestore(snapshot: admin.firestore.QueryDocumentSnapshot): webPush.PushSubscription {
        const data = snapshot.data();
        if (!data.endpoint || !data.keys || !data.keys.p256dh || !data.keys.auth) {
            throw new Error("Invalid PushSubscription data from Firestore.");
        }
        return {
            endpoint: data.endpoint,
            keys: {
                p256dh: data.keys.p256dh,
                auth: data.keys.auth
            }
        };
    }
};


// This is the v1 SDK syntax for onCall functions
export const getVapidPublicKey = functions.region("europe-west2").https.onCall((data, context) => {
    const publicKey = functions.config().webpush?.public_key;
    if (!publicKey) {
        functions.logger.error("CRITICAL: VAPID public key (webpush.public_key) not set in function configuration.");
        throw new functions.https.HttpsError('not-found', 'VAPID public key is not configured on the server.');
    }
    return { publicKey };
});

export const sendShiftNotification = functions.region("europe-west2").firestore.document("shifts/{shiftId}")
  .onWrite(async (change, context) => {
    const shiftId = context.params.shiftId;
    functions.logger.log(`Function triggered for shiftId: ${shiftId}`);

    const config = functions.config();
    const publicKey = config.webpush?.public_key;
    const privateKey = config.webpush?.private_key;

    if (!publicKey || !privateKey) {
      functions.logger.error("CRITICAL: VAPID keys are not configured. Run the Firebase CLI command from the 'VAPID Key Generator' in the admin panel.");
      return;
    }

    webPush.setVapidDetails(
      "mailto:example@your-project.com",
      publicKey,
      privateKey
    );

    const shiftDataBefore = change.before.data();
    const shiftDataAfter = change.after.data();
    
    let userId: string | null = null;
    let payload: object | null = null;

    if (change.after.exists && !change.before.exists) {
      // A new shift is created
      userId = shiftDataAfter?.userId;
      payload = {
        title: "New Shift Assigned",
        body: `You have a new shift: ${shiftDataAfter?.task} at ${shiftDataAfter?.address}.`,
        data: { url: `/dashboard` },
      };
    } else if (!change.after.exists && change.before.exists) {
      // A shift is deleted
      userId = shiftDataBefore?.userId;
      payload = {
        title: "Shift Cancelled",
        body: `Your shift for ${shiftDataBefore?.task} at ${shiftDataBefore?.address} has been cancelled.`,
        data: { url: `/dashboard` },
      };
    } else if (change.after.exists && change.before.exists) {
      // A shift is updated. Check for meaningful changes.
      const before = shiftDataBefore;
      const after = shiftDataAfter;
      
      if (!before || !after) {
        functions.logger.log("Shift update detected, but data is missing. No notification sent.");
        return;
      }

      // Compare relevant fields.
      const taskChanged = before.task !== after.task;
      const addressChanged = before.address !== after.address;
      const dateChanged = !before.date.isEqual(after.date);
      const typeChanged = before.type !== after.type;

      if (taskChanged || addressChanged || dateChanged || typeChanged) {
        userId = after.userId;
        payload = {
          title: "Your Shift Has Been Updated",
          body: `Details for one of your shifts have changed. Please check the app.`,
          data: { url: `/dashboard` },
        };
      } else {
        // No meaningful change, so no notification.
        functions.logger.log(`Shift ${shiftId} was updated, but no significant fields changed. No notification sent.`);
        return;
      }
    } else {
      functions.logger.log(`Shift ${shiftId} was updated, no notification sent.`);
      return;
    }

    if (!userId || !payload) {
      functions.logger.log("No notification necessary for this event.", {shiftId});
      return;
    }

    functions.logger.log(`Preparing to send notification for userId: ${userId}`);

    const subscriptionsSnapshot = await db
      .collection("users")
      .doc(userId)
      .collection("pushSubscriptions")
      .withConverter(pushSubscriptionConverter) // Apply the converter here
      .get();

    if (subscriptionsSnapshot.empty) {
      functions.logger.warn(`User ${userId} has no push subscriptions. Cannot send notification.`);
      return;
    }

    functions.logger.log(`Found ${subscriptionsSnapshot.size} subscriptions for user ${userId}.`);

    const sendPromises = subscriptionsSnapshot.docs.map((subDoc) => {
      // Thanks to the converter, subDoc.data() is now correctly typed as PushSubscription.
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
  });

export const projectReviewNotifier = functions
  .region("europe-west2")
  .pubsub.schedule("every 24 hours")
  .onRun(async (context) => {
    functions.logger.log("Running daily project review notifier.");

    const config = functions.config();
    const publicKey = config.webpush?.public_key;
    const privateKey = config.webpush?.private_key;

    if (!publicKey || !privateKey) {
      functions.logger.error("CRITICAL: VAPID keys are not configured. Cannot send project review notifications.");
      return;
    }

    webPush.setVapidDetails(
      "mailto:example@your-project.com",
      publicKey,
      privateKey
    );

    const now = admin.firestore.Timestamp.now();
    const projectsToReviewQuery = db.collection("projects").where("nextReviewDate", "<=", now);
    
    try {
        const querySnapshot = await projectsToReviewQuery.get();
        if (querySnapshot.empty) {
            functions.logger.log("No projects due for review today.");
            return;
        }

        functions.logger.log(`Found ${querySnapshot.size} projects to review.`);

        const batch = db.batch();

        for (const projectDoc of querySnapshot.docs) {
            const projectData = projectDoc.data();
            const { creatorId, address } = projectData;

            if (!creatorId) {
                functions.logger.warn(`Project ${projectDoc.id} (${address}) is due for review but has no creatorId. Skipping.`);
                continue;
            }

            const payload = JSON.stringify({
                title: "Project Review Reminder",
                body: `It's time to review the project at ${address}. Please check if it can be archived.`,
                data: { url: "/projects" },
            });

            const subscriptionsSnapshot = await db
                .collection("users")
                .doc(creatorId)
                .collection("pushSubscriptions")
                .withConverter(pushSubscriptionConverter)
                .get();
            
            if (subscriptionsSnapshot.empty) {
                functions.logger.warn(`Creator ${creatorId} for project ${address} has no push subscriptions.`);
            } else {
                functions.logger.log(`Sending review notification for project ${address} to creator ${creatorId}.`);
                const sendPromises = subscriptionsSnapshot.docs.map((subDoc) => {
                    const subscription = subDoc.data();
                    return webPush.sendNotification(subscription, payload).catch((error: any) => {
                        functions.logger.error(`Error sending notification to user ${creatorId}:`, error);
                        if (error.statusCode === 410 || error.statusCode === 404) {
                            functions.logger.log(`Deleting invalid subscription for user ${creatorId}.`);
                            return subDoc.ref.delete();
                        }
                        return null;
                    });
                });
                await Promise.all(sendPromises);
            }

            // Update the next review date for this project
            const newReviewDate = new Date();
            newReviewDate.setDate(newReviewDate.getDate() + 28); // 4 weeks from now
            batch.update(projectDoc.ref, { nextReviewDate: admin.firestore.Timestamp.fromDate(newReviewDate) });
        }
        
        // Commit all the project updates at once.
        await batch.commit();
        functions.logger.log("Finished processing project reviews and updated next review dates.");

    } catch (error) {
        functions.logger.error("Error running project review notifier:", error);
    }
  });
