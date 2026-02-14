import { NextRequest } from 'next/server';

/**
 * Internal file proxy API
 *
 * Browser -> Next.js (this file) -> Cloud Function (serveFile)
 *
 * This avoids CORS and respects internal ingress.
 */

const SERVE_FILE_URL =
  'https://us-central1-the-final-project-5e248.cloudfunctions.net/serveFile';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const path = searchParams.get('path');
  const download = searchParams.get('download');

  if (!path) {
    return new Response('Missing path', { status: 400 });
  }

  const upstreamUrl =
    `${SERVE_FILE_URL}?path=${encodeURIComponent(path)}` +
    (download ? '&download=1' : '');

  try {
    const upstream = await fetch(upstreamUrl, {
      // IMPORTANT: do NOT forward cookies
      headers: {
        'Accept': '*/*',
      },
    });

    if (!upstream.ok || !upstream.body) {
      return new Response('File not found', { status: 404 });
    }

    // Pass through headers safely
    const headers = new Headers();
    upstream.headers.forEach((value, key) => {
      if (
        key.toLowerCase() === 'content-type' ||
        key.toLowerCase() === 'content-disposition'
      ) {
        headers.set(key, value);
      }
    });

    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (err) {
    return new Response('File proxy error', { status: 500 });
  }
}
