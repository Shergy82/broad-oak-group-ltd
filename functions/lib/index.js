"use strict";
/**
 * Firebase Functions (Gen 2)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getVapidPublicKey = void 0;
const v2_1 = require("firebase-functions/v2");
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
(0, v2_1.setGlobalOptions)({ maxInstances: 10 });
const VAPID_PUBLIC_KEY = (0, params_1.defineSecret)("VAPID_PUBLIC_KEY");
exports.getVapidPublicKey = (0, https_1.onCall)({ region: "europe-west2", secrets: [VAPID_PUBLIC_KEY] }, async () => {
    return { publicKey: VAPID_PUBLIC_KEY.value() };
});
//# sourceMappingURL=index.js.map