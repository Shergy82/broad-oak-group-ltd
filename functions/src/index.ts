import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

// Initialize the Firebase Admin SDK
admin.initializeApp();

/**
 * This function is currently disabled to resolve deployment issues.
 * To re-enable, restore the logic for sending push notifications.
 */
export const sendShiftNotification = functions.firestore
  .document("shifts/{shiftId}")
  .onWrite(async (change, context) => {
    functions.logger.log(`Shift notification trigger for ${context.params.shiftId} ignored: Push notifications are disabled.`);
    return null;
  });
