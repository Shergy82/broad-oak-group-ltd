
'use client';

import { useEffect, useState, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import { Icon, LatLngExpression } from 'leaflet';
import { collection, getDocs, query, where, Timestamp } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import type { Shift } from '@/types';
import { Spinner } from '@/components/shared/spinner';

interface ShiftWithCoords extends Shift {
  coords: {
    lat: number;
    lng: number;
  };
}

interface LocationPin {
  position: LatLngExpression;
  popup: React.ReactNode;
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

const approxDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const latDist = Math.abs(lat1 - lat2) * 111;
    const lonDist = Math.abs(lon1 - lon2) * 111;
    return Math.sqrt(latDist * latDist + lonDist * lonDist);
};


export function StaffShiftMap() {
  const [shiftsWithCoords, setShiftsWithCoords] = useState<ShiftWithCoords[]>([]);
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
        const shiftsData = shiftSnapshot.docs.map(doc => ({id: doc.id, ...doc.data()} as Shift));

        const uniqueAddresses = [...new Set(shiftsData.map(s => s.address).filter(Boolean))];
        const geocodeCache = new Map<string, {lat: number, lng: number}>();

        await Promise.all(uniqueAddresses.map(async (address) => {
            try {
                const res = await fetch(`/api/geocode?address=${encodeURIComponent(address)}`);
                if (res.ok) {
                    const coords = await res.json();
                    geocodeCache.set(address, coords);
                }
            } catch (e) {
                console.error("Geocoding failed for:", address, e);
            }
        }));

        const geocodedShifts = shiftsData.map(shift => {
            const coords = geocodeCache.get(shift.address);
            return coords ? { ...shift, coords } : null;
        }).filter((s): s is ShiftWithCoords => s !== null);

        setShiftsWithCoords(geocodedShifts);

      } catch (error) {
        console.error("Failed to load and geocode shifts:", error);
      } finally {
        setLoading(false);
      }
    };

    loadShiftsAndGeocode();
  }, []);

  const locationPins = useMemo((): LocationPin[] => {
      const shiftsByAddress = new Map<string, ShiftWithCoords[]>();
      shiftsWithCoords.forEach(shift => {
          if (!shiftsByAddress.has(shift.address)) {
              shiftsByAddress.set(shift.address, []);
          }
          shiftsByAddress.get(shift.address)!.push(shift);
      });
      
      return Array.from(shiftsByAddress.values()).map(shiftsAtLocation => {
          const firstShift = shiftsAtLocation[0];
          const { lat, lng } = firstShift.coords;
          
          const otherShifts = shiftsWithCoords.filter(s => s.address !== firstShift.address);
          
          const distances = otherShifts.map(other => ({
              userId: other.userId,
              userName: other.userName || 'Unknown User',
              distance: approxDistance(lat, lng, other.coords.lat, other.coords.lng)
          })).sort((a,b) => a.distance - b.distance);
          
          const closestUsers = [];
          const seenUsers = new Set();
          for(const user of distances) {
              if(!seenUsers.has(user.userId)) {
                  closestUsers.push(user);
                  seenUsers.add(user.userId);
                  if (closestUsers.length >= 4) break;
              }
          }
          
          return {
              position: [lat, lng],
              popup: (
                <div className="space-y-2">
                  <h4 className="font-bold text-base">{firstShift.address}</h4>
                  <hr />
                  <div>
                    <p className="font-semibold">Operatives at this location:</p>
                    <ul className="list-none p-0 mt-1">
                        {shiftsAtLocation.map(s => (
                            <li key={s.id}><strong>{s.userName}:</strong> {s.task}</li>
                        ))}
                    </ul>
                  </div>
                  {closestUsers.length > 0 && (
                      <div>
                          <hr />
                          <p className="font-semibold mt-2">Closest Operatives:</p>
                          <ul className="list-none p-0 mt-1 text-sm text-muted-foreground">
                            {closestUsers.map(u => (
                                <li key={u.userId}>{u.userName} (~{(u.distance * 0.621371).toFixed(1)} miles away)</li>
                            ))}
                          </ul>
                      </div>
                  )}
                </div>
              )
          }
      })
  }, [shiftsWithCoords]);

  if (loading) {
    return <div className="h-[500px] flex items-center justify-center bg-muted rounded-md"><Spinner size="lg" /></div>;
  }
  
  if (locationPins.length === 0) {
      return <div className="h-[500px] flex items-center justify-center bg-muted rounded-md">No shift locations to display for today.</div>;
  }

  return (
    <MapContainer center={[53.0189, -1.9781]} zoom={13} style={{ height: '500px', width: '100%' }} className="rounded-md">
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      />
      {locationPins.map((loc, index) => (
        <Marker key={index} position={loc.position} icon={customIcon}>
          <Popup>
             {loc.popup}
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
