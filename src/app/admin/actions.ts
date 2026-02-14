'use server';

interface GeocodeResult {
    lat: number;
    lng: number;
    address: string;
}

export async function getProjectCoordinates(addresses: string[]): Promise<GeocodeResult[]> {
    const apiKey = process.env.NEXT_PUBLIC_MAPS_API_KEY;
    if (!apiKey) {
        console.error("Google Maps API key is missing on the server.");
        // Returning an empty array to avoid breaking the client, but logging the error.
        return [];
    }

    const results: GeocodeResult[] = [];

    for (const address of addresses) {
        if (!address) continue;
        try {
            const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`);
            
            if (!response.ok) {
                console.error(`Geocoding failed for ${address} with status: ${response.status}`);
                continue;
            }

            const data = await response.json();
            if (data.status === 'OK' && data.results && data.results.length > 0) {
                const { lat, lng } = data.results[0].geometry.location;
                results.push({ lat, lng, address });
            } else {
                console.warn(`Geocoding failed for ${address}: ${data.status} - ${data.error_message || ''}`);
            }
        } catch (error) {
            console.error(`Error geocoding address "${address}":`, error);
        }
    }
    return results;
}
