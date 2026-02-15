'use client';

import { GoogleMap, useJsApiLoader } from '@react-google-maps/api';
import { MarkerClusterer } from '@googlemaps/markerclusterer';
import { useEffect, useRef, useState } from 'react';
import { collection, getDocs, query, where, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';

const containerStyle = {
  width: '100%',
  height: '500px',
};

const statusColours: Record<string, string> = {
  'pending-confirmation': '#f97316', // orange
  'on-site': '#14b8a6',              // turquoise
  'completed': '#22c55e',            // green
  'incompleted': '#ef4444',          // red
};

export function StaffShiftMap() {
  const mapRef = useRef<google.maps.Map | null>(null);
  const clustererRef = useRef<MarkerClusterer | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const [shifts, setShifts] = useState<any[]>([]);

  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!,
  });

  // Load today's shifts
  useEffect(() => {
    const load = async () => {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date();
      end.setHours(23, 59, 59, 999);

      const q = query(
        collection(db, 'shifts')
      );      

      const snap = await getDocs(q);
      setShifts(
        snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(s => s.location?.lat && s.location?.lng)
      );
    };

    load();
  }, []);

  // Render markers
  useEffect(() => {
    if (!mapRef.current || !shifts.length) return;

    markersRef.current.forEach(m => m.setMap(null));
    markersRef.current = [];
    clustererRef.current?.clearMarkers();

    const markers = shifts.map(shift => {
      const colour = statusColours[shift.status] ?? '#6b7280';

      return new google.maps.Marker({
        position: {
          lat: shift.location.lat,
          lng: shift.location.lng,
        },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: colour,
          fillOpacity: 1,
          strokeColor: '#000',
          strokeWeight: 1,
        },
        title: shift.userName || 'Shift',
      });
    });

    clustererRef.current = new MarkerClusterer({
      map: mapRef.current,
      markers,
    });

    markersRef.current = markers;
  }, [shifts]);

  if (!isLoaded) {
    return <div className="h-[500px] rounded-md bg-muted" />;
  }

  return (
    <GoogleMap
      mapContainerStyle={containerStyle}
      center={{ lat: 54.5, lng: -2 }} // UK
      zoom={6}
      onLoad={map => (mapRef.current = map)}
    />
  );
}
