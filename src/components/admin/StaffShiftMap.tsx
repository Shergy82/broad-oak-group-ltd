'use client';

import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import { Icon, LatLngExpression } from 'leaflet';
import { collection, getDocs, query, where, Timestamp } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import type { Shift } from '@/types';
import { Spinner } from '@/components/shared/spinner';

interface LocationPin {
  position: LatLngExpression;
  popupText: string;
}

// Fix for default Leaflet icon path in Next.js
const customIcon = new Icon({
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});


export function StaffShiftMap() {
  const [locations, setLocations] = useState<LocationPin[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadShiftsAndGeocode = async () => {
      if (!db) {
        setLoading(false);
        return;
      }
      setLoading(true);

      try {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);

        const shiftsQuery = query(
          collection(db, 'shifts'),
          where('date', '>=', Timestamp.fromDate(todayStart)),
          where('date', '<=', Timestamp.fromDate(todayEnd))
        );

        const shiftSnapshot = await getDocs(shiftsQuery);
        const shiftsData = shiftSnapshot.docs.map(doc => doc.data() as Shift);

        // Group shifts by address to avoid redundant geocoding calls
        const shiftsByAddress = shiftsData.reduce((acc, shift) => {
          if (shift.address) {
            if (!acc[shift.address]) {
              acc[shift.address] = [];
            }
            acc[shift.address].push(shift);
          }
          return acc;
        }, {} as Record<string, Shift[]>);

        const geocodePromises = Object.entries(shiftsByAddress).map(async ([address, shifts]) => {
          try {
            const res = await fetch(`/api/geocode?address=${encodeURIComponent(address)}`);
            if (res.ok) {
              const { lat, lng } = await res.json();
              
              const popupContent = `
                <div style="font-family: sans-serif;">
                  <strong style="font-size: 1.1em;">${address}</strong>
                  <hr style="margin: 4px 0;" />
                  <ul style="list-style: none; padding: 0; margin: 0;">
                    ${shifts.map(s => `
                      <li style="margin-bottom: 4px;">
                        <strong>${s.userName || 'N/A'}:</strong> ${s.task}
                      </li>
                    `).join('')}
                  </ul>
                </div>
              `;

              return {
                position: [lat, lng] as LatLngExpression,
                popupText: popupContent,
              };
            }
          } catch (e) {
            console.error("Geocoding error for:", address, e);
          }
          return null;
        });

        const resolvedLocations = (await Promise.all(geocodePromises)).filter((l): l is LocationPin => l !== null);
        setLocations(resolvedLocations);
      } catch (error) {
        console.error("Failed to load and geocode shifts:", error);
      } finally {
        setLoading(false);
      }
    };

    loadShiftsAndGeocode();
  }, []);

  if (loading) {
    return <div className="h-[500px] flex items-center justify-center bg-muted rounded-md"><Spinner size="lg" /></div>;
  }
  
  if (locations.length === 0) {
      return <div className="h-[500px] flex items-center justify-center bg-muted rounded-md">No shift locations to display for today.</div>;
  }

  return (
    <MapContainer center={[54.5, -2]} zoom={6} style={{ height: '500px', width: '100%' }} className="rounded-md">
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      />
      {locations.map((loc, index) => (
        <Marker key={index} position={loc.position} icon={customIcon}>
          <Popup>
             <div dangerouslySetInnerHTML={{ __html: loc.popupText }} />
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
