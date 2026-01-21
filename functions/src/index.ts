/**
 * Firebase Functions (Gen 2)
 */

import { setGlobalOptions } from "firebase-functions/v2";
import { onCall } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";

setGlobalOptions({ maxInstances: 10 });

const VAPID_PUBLIC_KEY = defineSecret("VAPID_PUBLIC_KEY");

export const getVapidPublicKey = onCall(
  { region: "europe-west2", secrets: [VAPID_PUBLIC_KEY] },
  async () => {
    try {
      // Retrieve the secret value. Use `.value()` to access the secret's content.
      const raw = await VAPID_PUBLIC_KEY.value();

      // Normalize URL-safe base64 to standard base64 for decoding
      const base64 = raw.replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
      const padding = '='.repeat((4 - (base64.length % 4)) % 4);
      const normalized = base64 + padding;

      const buf = Buffer.from(normalized, 'base64');
      const length = buf.length;
      const firstByte = buf.length > 0 ? buf[0] : null;

      // Log non-sensitive debug info (length and first byte) to help diagnose client errors.
      console.info('getVapidPublicKey: decoded key length=' + length + ', firstByte=0x' + (firstByte !== null ? firstByte.toString(16) : 'null'));

      return { publicKey: raw };
    } catch (err) {
      console.error('Error reading VAPID public key secret:', err);
      throw err;
    }
  }
);
