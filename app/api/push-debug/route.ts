import { NextResponse } from "next/server";
import * as admin from "firebase-admin";
import webPush from "web-push";

export const dynamic = "force-dynamic";

function getDb() {
  if (admin.apps.length === 0) admin.initializeApp();
  return admin.firestore();
}

function configureWebPush() {
  const pub =
    process.env.WEBPUSH_PUBLIC_KEY ||
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ||
    "";

  const priv =
    process.env.WEBPUSH_PRIVATE_KEY ||
    process.env.NEXT_PUBLIC_VAPID_PRIVATE_KEY ||
    "";

  const subj =
    process.env.WEBPUSH_SUBJECT || "mailto:example@example.com";

  if (!pub || !priv) {
    throw new Error("Missing WEBPUSH/VAPID keys");
  }

  webPush.setVapidDetails(subj, pub, priv);
}

export async function GET() {
  try {
    configureWebPush();
    const db = getDb();

    const snap = await db
      .collectionGroup("pushSubscriptions")
      .limit(1)
      .get();

    if (snap.empty) {
      return NextResponse.json(
        { ok: false, error: "No push subscriptions found in Firestore" },
        { status: 404, headers: { "cache-control": "no-store" } }
      );
    }

    const sub = snap.docs[0].data() as any;

    await webPush.sendNotification(
      sub,
      JSON.stringify({
        title: "Test push",
        body: "If you see this, web-push + VAPID is working.",
        url: "/",
      })
    );

    return NextResponse.json(
      { ok: true, sentTo: snap.docs[0].ref.path },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500, headers: { "cache-control": "no-store" } }
    );
  }
}
