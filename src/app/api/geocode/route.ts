import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const address = searchParams.get('address');

  if (!address) {
    return NextResponse.json({ error: 'Address is required' }, { status: 400 });
  }

  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`,
      {
        headers: {
          'User-Agent': 'BroadOakGroupApp/1.0 (Firebase Studio)',
        },
      }
    );

    if (!response.ok) {
        throw new Error(`Nominatim API failed with status ${response.status}`);
    }

    const data = await response.json();

    if (data.length > 0) {
      const { lat, lon } = data[0];
      return NextResponse.json({ lat: parseFloat(lat), lng: parseFloat(lon) });
    } else {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 });
    }
  } catch (error: any) {
    console.error('Geocoding error:', error);
    return NextResponse.json({ error: 'Failed to geocode address' }, { status: 500 });
  }
}
