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
    return { publicKey: VAPID_PUBLIC_KEY.value() };
  }
);
