import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { genkit } from "genkit";
import { googleAI } from "@genkit-ai/google-genai";
import { z } from "zod";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();

/* =====================================================
   ENV
===================================================== */

const GEOCODING_KEY =
  process.env.GOOGLE_GEOCODING_KEY ||
  require('firebase-functions').config().google.geocoding_key;

/* =====================================================
   NOTIFICATION STATUS (REQUIRED BY FRONTEND)
===================================================== */

export const getNotificationStatus = onCall(
  { region: 'europe-west2' },
  async (req) => {
    if (!req.auth) {
      throw new HttpsError('unauthenticated', 'Login required');
    }

    const doc = await db.collection('users').doc(req.auth.uid).get();
    return { enabled: doc.data()?.notificationsEnabled ?? false };
  }
);

export const setNotificationStatus = onCall(
  { region: 'europe-west2' },
  async (req) => {
    if (!req.auth) {
      throw new HttpsError('unauthenticated', 'Login required');
    }

    if (typeof req.data?.enabled !== 'boolean') {
      throw new HttpsError('invalid-argument', 'enabled must be boolean');
    }

    await db
      .collection('users')
      .doc(req.auth.uid)
      .set({ notificationsEnabled: req.data.enabled }, { merge: true });

    return { success: true };
  }
);

/* =====================================================
   USER MANAGEMENT (OWNER ONLY)
===================================================== */

const assertIsOwner = async (uid?: string) => {
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  const snap = await db.collection('users').doc(uid).get();
  if (snap.data()?.role !== 'owner') {
    throw new HttpsError('permission-denied', 'Owner role required');
  }
};

export const setUserStatus = onCall(
  { region: 'europe-west2' },
  async (req) => {
    await assertIsOwner(req.auth?.uid);

    const { uid, disabled, newStatus } = req.data;

    if (
      typeof uid !== 'string' ||
      typeof disabled !== 'boolean' ||
      !['active', 'suspended'].includes(newStatus)
    ) {
      throw new HttpsError(
        'invalid-argument',
        'uid, disabled, and valid newStatus are required'
      );
    }

    await admin.auth().updateUser(uid, { disabled });
    await db.collection('users').doc(uid).update({ status: newStatus });

    return { success: true };
  }
);

export const deleteUser = onCall(
  { region: 'europe-west2' },
  async (req) => {
    await assertIsOwner(req.auth?.uid);

    const { uid } = req.data;
    if (typeof uid !== 'string') {
      throw new HttpsError('invalid-argument', 'uid is required');
    }

    await admin.auth().deleteUser(uid);
    await db.collection('users').doc(uid).delete();

    return { success: true };
  }
);

/* =====================================================
   ONE-OFF: RE-GEOCODE ALL SHIFTS
===================================================== */

export const reGeocodeAllShifts = onCall(
  {
    region: 'europe-west2',
    timeoutSeconds: 540,
    memory: '1GiB',
  },
  async (req) => {
    await assertIsOwner(req.auth?.uid);

    if (!GEOCODING_KEY) {
      throw new HttpsError(
        'failed-precondition',
        'Missing Google Geocoding API key'
      );
    }

    const snap = await db.collection('shifts').get();

    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (const doc of snap.docs) {
      const data = doc.data();

      if (!data?.address) {
        skipped++;
        continue;
      }

      const address = encodeURIComponent(`${data.address}, UK`);
      const url =
        `https://maps.googleapis.com/maps/api/geocode/json?` +
        `address=${address}&key=${GEOCODING_KEY}`;

      try {
        const res = await fetch(url);
        const json: any = await res.json();

        if (json.status !== 'OK' || !json.results?.length) {
          failed++;
          continue;
        }

        const result = json.results[0];
        const { lat, lng } = result.geometry.location;
        const accuracy = result.geometry.location_type;

        await doc.ref.update({
          location: {
            lat,
            lng,
            accuracy, // ROOFTOP | RANGE_INTERPOLATED | POSTAL_CODE
          },
        });

        updated++;
      } catch (err) {
        failed++;
      }
    }

    return { updated, skipped, failed };
  }
);

/* =====================================================
   AI ASSISTANT
===================================================== */

// Genkit initialization
const ai = genkit({
    plugins: [googleAI({
        apiKey: process.env.GEMINI_API_KEY,
    })],
});

// Tool to get today's shifts with locations
const getTodaysShifts = ai.defineTool(
    {
        name: "getTodaysShifts",
        description: "Get all of today's shifts that have a geo-location.",
        outputSchema: z.array(z.object({
            userId: z.string(),
            userName: z.string().describe("The name of the user assigned to the shift."),
            address: z.string(),
            lat: z.number(),
            lng: z.number(),
        })),
    },
    async () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const shiftsSnap = await db.collection("shifts")
            .where('date', '>=', today)
            .where('date', '<', tomorrow)
            .get();
        
        return shiftsSnap.docs
            .map(doc => doc.data())
            .filter(data => data.location?.lat && data.location?.lng)
            .map(data => ({
                userId: data.userId,
                userName: data.userName,
                address: data.address,
                lat: data.location.lat,
                lng: data.location.lng,
            }));
    }
);

// Main AI Assistant Flow
const assistantFlow = ai.defineFlow(
    {
        name: "assistantFlow",
        inputSchema: z.string(),
        outputSchema: z.string(),
    },
    async (query) => {
        const llmResponse = await ai.generate({
            model: "gemini-1.5-flash-latest",
            tools: [getTodaysShifts],
            prompt: `You are an assistant for a construction company called Broad Oak Group.
            Your role is to answer questions based on the available data about users and their shifts for today.
            Use the provided tools to find information.
            When asked about locations or who is "near" someone, you must use the getTodaysShifts tool.
            After getting the shifts, identify the users involved in the query.
            Find the location of the primary user mentioned.
            Then, calculate the distance between the primary user and all other users with shifts today.
            Respond with the name of the user who is closest and their approximate distance in a human-readable format.
            If you cannot find the specified user or if there are no other users with shifts today, respond with a helpful message explaining the situation.
            Assume a simple euclidean distance calculation on lat/lng is sufficient for a rough estimate, and you can approximate 1 degree of latitude/longitude as 111 kilometers.

            Today is ${new Date().toDateString()}.

            Question: "${query}"`,
        });

        return llmResponse.text || "I'm sorry, I couldn't process that request.";
    }
);

// The callable function that the frontend will invoke
export const askAIAssistant = onCall({ region: "europe-west2", memory: "1GiB" }, async (req) => {
    if (!req.auth) {
        throw new HttpsError("unauthenticated", "Authentication required.");
    }
    const query = req.data.query as string;
    if (!query) {
        throw new HttpsError("invalid-argument", "Query is required.");
    }
    try {
        const response = await assistantFlow(query);
        return { response };
    } catch (e: any) {
        console.error("AI assistant flow failed", e);
        throw new HttpsError("internal", "The AI assistant failed to process your request.");
    }
});
