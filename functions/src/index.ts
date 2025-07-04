
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";

admin.initializeApp();

/**
 * This function is temporarily disabled to ensure build stability.
 */
export const getVapidPublicKey = onCall({ region: "europe-west2" }, (request) => {
  logger.error("getVapidPublicKey called, but push notifications are temporarily disabled.");
  throw new HttpsError('unavailable', 'Push notifications are temporarily disabled to ensure build stability.');
});

/**
 * This function is a placeholder and is disabled to ensure build stability.
 * The original logic for sending notifications will be restored once the build is stable.
 */
export const sendShiftNotification = onDocumentWritten(
  {
    document: "shifts/{shiftId}",
    region: "europe-west2",
  },
  (event) => {
    logger.log(`sendShiftNotification triggered for shiftId: ${event.params.shiftId}, but the feature is disabled.`);
    return Promise.resolve();
  }
);
