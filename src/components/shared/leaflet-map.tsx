'use client';

import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import { Icon, LatLngExpression } from 'leaflet';
import { useEffect, useState } from 'react';
import type { Project } from '@/types';
import { Spinner } from './spinner';

interface LeafletMapProps {
    locations: Project[];
}

interface Position {
    lat: number;
    lng: number;
    address: string;
}

const customIcon = new Icon({
    iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
    shadowSize: [41, 41]
});

const LeafletMap = ({ locations }: LeafletMapProps) => {
    const [positions, setPositions] = useState<Position[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const geocodeAddresses = async () => {
            setLoading(true);
            setError(null);
            const newPositions: Position[] = [];
            const apiKey = process.env.NEXT_PUBLIC_MAPS_API_KEY;

            if (!apiKey) {
                setError("Google Maps API key is missing. Please check your environment variables.");
                setLoading(false);
                return;
            }

            for (const location of locations) {
                if (!location.address) continue;
                try {
                    const query = `${location.address}, ${location.council || ''}`;
                    const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${apiKey}`);
                    
                    if (!response.ok) {
                        console.error(`Geocoding failed for ${location.address} with status: ${response.status}`);
                        continue;
                    }
                    const data = await response.json();
                    if (data.status === 'OK' && data.results && data.results.length > 0) {
                        const { lat, lng } = data.results[0].geometry.location;
                        newPositions.push({
                            lat,
                            lng,
                            address: location.address,
                        });
                    } else {
                        console.warn(`Geocoding failed for ${location.address}: ${data.status} - ${data.error_message || ''}`);
                        if (data.status === 'REQUEST_DENIED') {
                            setError('Geocoding API is not enabled. Please enable it in the Google Cloud Console.');
                        }
                    }
                } catch (error) {
                    console.error('Geocoding error:', error);
                }
            }
            setPositions(newPositions);
            setLoading(false);
        };

        if (locations.length > 0) {
            geocodeAddresses();
        } else {
            setLoading(false);
        }
    }, [locations]);
    
    const defaultCenter: LatLngExpression = [53.0027, -2.1794]; // Stoke-on-Trent

    if (loading) {
        return (
            <div className="h-full w-full flex flex-col items-center justify-center bg-muted rounded-lg">
                <Spinner size="lg" />
                <p className="mt-4 text-sm text-muted-foreground">Plotting project locations...</p>
            </div>
        );
    }
    
    if (error) {
        return (
             <div className="h-full w-full flex flex-col items-center justify-center bg-destructive/10 text-destructive p-4 rounded-lg">
                <p className="font-semibold">Map Error</p>
                <p className="text-sm text-center">{error}</p>
            </div>
        )
    }

    if (locations.length > 0 && positions.length === 0 && !loading) {
        return (
             <div className="h-full w-full flex flex-col items-center justify-center bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">Could not determine project locations.</p>
            </div>
        )
    }

    return (
        <MapContainer 
            center={positions.length > 0 ? [positions[0].lat, positions[0].lng] : defaultCenter} 
            zoom={locations.length > 1 ? 8 : 12} 
            style={{ height: '100%', width: '100%', borderRadius: 'inherit' }}
            scrollWheelZoom={true}
        >
            <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            />
            {positions.map((pos, index) => (
                <Marker key={index} position={[pos.lat, pos.lng]} icon={customIcon}>
                    <Popup>{pos.address}</Popup>
                </Marker>
            ))}
        </MapContainer>
    );
};

export default LeafletMap;
