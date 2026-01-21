/**
 * Firebase Functions (Gen 2)
 */

import { setGlobalOptions } from "firebase-functions/v2";
import { onCall } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";

setGlobalOptions({ maxInstances: 10, region: "europe-west2" });

admin.initializeApp();

const VAPID_PUBLIC_KEY = defineSecret("VAPID_PUBLIC_KEY");

/**
 * Callable: returns the VAPID public key (used by web push subscription)
 */
export const getVapidPublicKey = onCall(
  { region: "europe-west2", secrets: [VAPID_PUBLIC_KEY] },
  async () => {
    try {
      const raw = await VAPID_PUBLIC_KEY.value();

      // Normalize URL-safe base64 to standard base64 for decoding
      const base64 = raw.replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
      const padding = "=".repeat((4 - (base64.length % 4)) % 4);
      const normalized = base64 + padding;

      const buf = Buffer.from(normalized, "base64");
      const length = buf.length;
      const firstByte = buf.length > 0 ? buf[0] : null;

      console.info(
        "getVapidPublicKey: decoded key length=" +
          length +
          ", firstByte=0x" +
          (firstByte !== null ? firstByte.toString(16) : "null")
      );

      return { publicKey: raw };
    } catch (err) {
      console.error("Error reading VAPID public key secret:", err);
      throw err;
    }
  }
);

/**
 * Firestore Trigger: sends a push notification when a shift is created/updated.
 *
 * Expects:
 * - shifts stored at: shifts/{shiftId}
 * - shift doc contains one of: userId OR assignedToUid OR workerId (uid of the worker)
 * - tokens stored at: users/{uid}/pushSubscriptions/{doc}
 *   where token is in field "fcmToken" or "token", or doc ID is the token
 */
export const sendShiftNotification = onDocumentWritten(
  { document: "shifts/{shiftId}", region: "europe-west2" },
  async (event) => {
    const after = event.data?.after?.data() as any | undefined;
    const before = event.data?.before?.data() as any | undefined;

    // Ignore deletes
    if (!after) return;

    const shiftId = event.params.shiftId;

    // Only notify on create or meaningful updates
    const isCreate = !before;
    const meaningfulChange =
      !before ||
      after.status !== before.status ||
      after.startTime !== before.startTime ||
      after.endTime !== before.endTime ||
      after.address !== before.address;

    if (!isCreate && !meaningfulChange) {
      console.info("sendShiftNotification: no meaningful change, skipping", { shiftId });
      return;
    }

    // Determine target user
    const uid =
      (after.userId as string) ||
      (after.assignedToUid as string) ||
      (after.workerId as string);

    if (!uid) {
      console.warn("sendShiftNotification: missing uid field on shift", { shiftId });
      return;
    }

    // Get tokens
    const subsSnap = await admin
      .firestore()
      .collection("users")
      .doc(uid)
      .collection("pushSubscriptions")
      .get();

    const tokens: string[] = [];
    subsSnap.forEach((doc) => {
      const d = doc.data() as any;
      const token = (d.fcmToken as string) || (d.token as string) || doc.id;
      if (token) tokens.push(token);
    });

    if (tokens.length === 0) {
      console.info("sendShiftNotification: no tokens for user", { uid, shiftId });
      return;
    }

    // Build a payload that displays on iPhone PWA + desktop
    const title = isCreate ? "New shift assigned" : "Shift updated";
    const body = "Tap to view your shift details.";

    const link =
      "https://broad-oak-group-ltd--the-final-project-5e248.europe-west4.hosted.app/shifts";

    // IMPORTANT: Do NOT type this as MulticastMessage (it requires tokens).
    // We build a "message without token/topic/condition" and add tokens at send time.
    const baseMessage: Omit<
      admin.messaging.Message,
      "token" | "topic" | "condition"
    > = {
      notification: { title, body },
      webpush: {
        headers: { Urgency: "high" },
        notification: {
          title,
          body,
          icon: "/icons/icon-192.png",
          badge: "/icons/icon-192.png",
          data: { url: "/shifts" },
        },
        fcmOptions: { link },
      },
      data: {
        type: isCreate ? "shift_created" : "shift_updated",
        shiftId,
      },
    };

    const res = await admin.messaging().sendEachForMulticast({
      ...baseMessage,
      tokens,
    });

    const successCount = res.responses.filter((r) => r.success).length;
    console.info("sendShiftNotification: push attempted", {
      uid,
      shiftId,
      tokenCount: tokens.length,
      successCount,
    });

    // Optional: remove dead tokens (only works if doc.id == token)
    const dead: string[] = [];
    res.responses.forEach((r, i) => {
      if (!r.success) {
        const code = (r.error as any)?.code || "";
        console.warn("sendShiftNotification: push failed", {
          uid,
          shiftId,
          token: tokens[i],
          code,
          message: r.error?.message,
        });

        if (
          code.includes("registration-token-not-registered") ||
          code.includes("invalid-argument")
        ) {
          dead.push(tokens[i]);
        }
      }
    });

    if (dead.length) {
      const batch = admin.firestore().batch();
      for (const t of dead) {
        batch.delete(
          admin.firestore().collection("users").doc(uid).collection("pushSubscriptions").doc(t)
        );
      }
      await batch.commit().catch(() => {});
      console.warn("sendShiftNotification: cleaned dead tokens", {
        uid,
        deadCount: dead.length,
      });
    }
  }
);
