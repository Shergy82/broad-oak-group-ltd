// functions/src/geocodeShift.ts
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import fetch from "node-fetch";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const GEOCODING_KEY =
  process.env.GOOGLE_GEOCODING_KEY ||
  require("firebase-functions").config().google.geocoding_key;

export const geocodeShiftOnCreate = onDocumentCreated(
  "shifts/{shiftId}",
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const data = snap.data();

    // Must have a full address
    if (!data?.address) return;

    // Do not overwrite existing coordinates
    if (data?.location?.lat && data?.location?.lng) return;

    if (!GEOCODING_KEY) {
      console.error("Missing Geocoding API key");
      return;
    }

    const address = encodeURIComponent(`${data.address}, UK`);

    const url =
      `https://maps.googleapis.com/maps/api/geocode/json?` +
      `address=${address}&key=${GEOCODING_KEY}`;

    const res = await fetch(url);
    const json = (await res.json()) as any;

    if (json.status !== "OK" || !json.results?.length) {
      console.warn("Geocoding failed", data.address, json.status);
      return;
    }

    const result = json.results[0];
    const { lat, lng } = result.geometry.location;
    const accuracy = result.geometry.location_type;

    await snap.ref.update({
      location: {
        lat,
        lng,
        accuracy, // ROOFTOP | RANGE_INTERPOLATED | POSTAL_CODE
      },
    });
  }
);
