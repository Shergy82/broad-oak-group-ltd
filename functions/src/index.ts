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

      // Normalize URL-safe base64 to standard base64 for decoding (debug only)
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
 *   where the FCM token must be stored in field "fcmToken"
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
      after.status !== before?.status ||
      after.startTime !== before?.startTime ||
      after.endTime !== before?.endTime ||
      after.address !== before?.address;

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

    // Read subscriptions and collect ONLY real FCM tokens
    const subsSnap = await admin
      .firestore()
      .collection("users")
      .doc(uid)
      .collection("pushSubscriptions")
      .get();

    const tokens: string[] = [];
    const docsByToken = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();

    subsSnap.forEach((docSnap) => {
      const d = docSnap.data() as any;

      const token = typeof d.fcmToken === "string" ? d.fcmToken.trim() : "";
      if (!token) return;

      // Basic sanity checks: tokens aren't URLs and are usually long-ish
      if (token.startsWith("http") || token.includes("://") || token.length < 50) {
        console.warn("sendShiftNotification: skipping non-FCM token", {
          uid,
          shiftId,
          docId: docSnap.id,
          tokenSample: token.slice(0, 25),
        });
        return;
      }

      tokens.push(token);
      docsByToken.set(token, docSnap);
    });

    if (tokens.length === 0) {
      console.info("sendShiftNotification: no valid FCM tokens for user", { uid, shiftId });
      return;
    }

    // Notification content
    const title = isCreate ? "New shift assigned" : "Shift updated";
    const body = "Tap to view your shift details.";

    const link =
      "https://broad-oak-group-ltd--the-final-project-5e248.europe-west4.hosted.app/shifts";

    // Build a "message without token/topic/condition" and add tokens at send time.
    const baseMessage: Omit<admin.messaging.Message, "token" | "topic" | "condition"> = {
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
        url: "/shifts",
      },
    };

    // Send to tokens
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

    // Remove dead tokens by deleting the *doc that contained them*
    const batch = admin.firestore().batch();
    let deadCount = 0;

    res.responses.forEach((r, i) => {
      if (r.success) return;

      const token = tokens[i];
      const code = (r.error as any)?.code || "";

      console.warn("sendShiftNotification: push failed", {
        uid,
        shiftId,
        code,
        message: r.error?.message,
        tokenSample: token.slice(0, 25),
      });

      const isDead =
        code.includes("registration-token-not-registered") ||
        code.includes("invalid-argument") ||
        code.includes("invalid-registration-token");

      if (isDead) {
        const snap = docsByToken.get(token);
        if (snap) {
          batch.delete(snap.ref);
          deadCount++;
        }
      }
    });

    if (deadCount > 0) {
      await batch.commit().catch(() => {});
      console.warn("sendShiftNotification: cleaned dead tokens", { uid, deadCount });
    }
  }
);
