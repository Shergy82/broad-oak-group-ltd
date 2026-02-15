'use client';

import { GoogleMap, Marker, useJsApiLoader } from '@react-google-maps/api';
import { useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';

const containerStyle = {
  width: '100%',
  height: '500px',
};

const UK_CENTER = { lat: 54.5, lng: -2 };

const statusColours: Record<string, string> = {
  'pending-confirmation': '#f97316', // orange
  'on-site': '#14b8a6',              // turquoise
  completed: '#22c55e',              // green
  incompleted: '#ef4444',            // red
};

type Shift = {
  id: string;
  status?: string;
  userName?: string;
  location: {
    lat: number;
    lng: number;
  };
};

export function StaffShiftMap() {
  const [shifts, setShifts] = useState<Shift[]>([]);

  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!,
  });

  useEffect(() => {
    const load = async () => {
      const snap = await getDocs(collection(db, 'shifts'));

      const mapped: Shift[] = snap.docs
        .map(doc => ({
          id: doc.id,
          ...(doc.data() as any),
        }))
        .filter(
          shift =>
            typeof shift.location?.lat === 'number' &&
            typeof shift.location?.lng === 'number'
        );

      console.log('MAP SHIFTS:', mapped);
      setShifts(mapped);
    };

    load();
  }, []);

  if (!isLoaded) {
    return <div className="h-[500px] rounded-md bg-muted" />;
  }

  return (
    <GoogleMap
      mapContainerStyle={containerStyle}
      center={UK_CENTER}
      zoom={6}
    >
      {shifts.map(shift => (
        <Marker
          key={shift.id}
          position={{
            lat: shift.location.lat,
            lng: shift.location.lng,
          }}
          title={shift.userName || 'Shift'}
          icon={{
            path: google.maps.SymbolPath.CIRCLE,
            scale: 9,
            fillColor: statusColours[shift.status ?? ''] ?? '#6b7280',
            fillOpacity: 1,
            strokeColor: '#000',
            strokeWeight: 1,
          }}
        />
      ))}
    </GoogleMap>
  );
}
