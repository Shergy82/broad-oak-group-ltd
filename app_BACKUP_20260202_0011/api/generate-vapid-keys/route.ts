// This file is no longer used for VAPID key generation
// to prevent server-side modules from being bundled with client code.
// The logic has been moved to a callable Cloud Function in /functions/src/index.ts
'use server';

export async function GET() {
  return new Response(
    JSON.stringify({
      error: 'This endpoint is deprecated. VAPID key logic is now in a callable Cloud Function.',
    }),
    {
      status: 410, // Gone
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );
}
