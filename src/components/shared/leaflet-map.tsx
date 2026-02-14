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

    useEffect(() => {
        const geocodeAddresses = async () => {
            setLoading(true);
            const newPositions: Position[] = [];
            for (const location of locations) {
                if (!location.address) continue;
                try {
                    const query = `${location.address}, ${location.council || ''}`;
                    const response = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`);
                    if (!response.ok) {
                        console.error(`Geocoding failed for ${location.address} with status: ${response.status}`);
                        continue;
                    }
                    const data = await response.json();
                    if (data && data.length > 0) {
                        newPositions.push({
                            lat: parseFloat(data[0].lat),
                            lng: parseFloat(data[0].lon),
                            address: location.address,
                        });
                    }
                    await new Promise(resolve => setTimeout(resolve, 1000));
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
            scrollWheelZoom={true} // Enable scroll wheel zoom without Ctrl
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
