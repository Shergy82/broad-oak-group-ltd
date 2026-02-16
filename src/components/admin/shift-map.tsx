'use client';

import { useState, useEffect, useMemo } from 'react';
import { GoogleMap, useJsApiLoader, Marker, InfoWindow } from '@react-google-maps/api';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Shift } from '@/types';
import { format } from 'date-fns';
import { Spinner } from '@/components/shared/spinner';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { MapPin } from 'lucide-react';

const containerStyle = {
  width: '100%',
  height: '600px',
};

// Center of the UK
const center = {
  lat: 54.00366,
  lng: -2.547855,
};

const getCorrectedLocalDate = (date: { toDate: () => Date }): Date => {
  if (!date || !date.toDate) return new Date();
  const d = date.toDate();
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

export function ShiftMap() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedShift, setSelectedShift] = useState<Shift | null>(null);

  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '',
  });

  useEffect(() => {
    const shiftsQuery = query(collection(db, 'shifts'));
    const unsubscribe = onSnapshot(shiftsQuery, (snapshot) => {
      const fetchedShifts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Shift));
      // Filter out shifts without valid location data right away
      const geocodedShifts = fetchedShifts.filter(shift => 
        shift.location && 
        typeof shift.location.lat === 'number' && 
        typeof shift.location.lng === 'number'
      );
      setShifts(geocodedShifts);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching shifts:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  if (loadError) {
      return (
          <Alert variant="destructive">
              <MapPin className="h-4 w-4" />
              <AlertTitle>Map Error</AlertTitle>
              <AlertDescription>
                Could not load Google Maps. This is likely because the Google Maps API key is missing or invalid. 
                Please set the `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` environment variable in your project.
              </AlertDescription>
          </Alert>
      )
  }
  
  if (loading || !isLoaded) {
    return <div className="flex items-center justify-center h-[600px]"><Spinner size="lg" /></div>;
  }

  return (
    <GoogleMap
      mapContainerStyle={containerStyle}
      center={center}
      zoom={6}
    >
      {shifts.map((shift) => (
        <Marker
          key={shift.id}
          position={{ lat: shift.location.lat, lng: shift.location.lng }}
          onClick={() => setSelectedShift(shift)}
        />
      ))}

      {selectedShift && selectedShift.location && (
        <InfoWindow
          position={{ lat: selectedShift.location.lat, lng: selectedShift.location.lng }}
          onCloseClick={() => setSelectedShift(null)}
        >
          <div className="p-1 space-y-1 max-w-xs">
            <h4 className="font-semibold text-sm">{selectedShift.task}</h4>
            <p className="text-xs">{selectedShift.address}</p>
            <p className="text-xs text-muted-foreground">
              {selectedShift.userName} on {format(getCorrectedLocalDate(selectedShift.date), 'PPP')}
            </p>
          </div>
        </InfoWindow>
      )}
    </GoogleMap>
  );
}
