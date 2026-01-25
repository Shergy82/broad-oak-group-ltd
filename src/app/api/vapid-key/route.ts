import { NextResponse } from 'next/server';

export async function GET() {
  const publicKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;

  if (!publicKey) {
    console.error("VAPID public key is not configured in environment variables (NEXT_PUBLIC_FIREBASE_VAPID_KEY).");
    return NextResponse.json({ error: 'VAPID public key not configured on the server.' }, { status: 500 });
  }

  return NextResponse.json({ publicKey });
}
