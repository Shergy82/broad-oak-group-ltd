// functions/src/geocodeShift.ts
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import fetch from "node-fetch";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY!;

export const geocodeShiftOnCreate = onDocumentCreated(
  "shifts/{shiftId}",
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const data = snap.data();
    if (!data?.postcode) return;
    if (data?.location?.lat && data?.location?.lng) return;

    const postcode = encodeURIComponent(data.postcode);
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${postcode}&key=${GOOGLE_API_KEY}`;

    const res = await fetch(url);
    const json = await res.json();

    if (!json.results?.length) return;

    const { lat, lng } = json.results[0].geometry.location;

    await snap.ref.update({
      location: { lat, lng },
    });
  }
);
