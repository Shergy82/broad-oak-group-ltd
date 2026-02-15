
'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { GoogleMap, Marker, InfoWindow, useJsApiLoader } from '@react-google-maps/api';
import { collection, getDocs, query, where, Timestamp } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import type { Shift } from '@/types';
import { Spinner } from '@/components/shared/spinner';

interface Coords {
    lat: number;
    lng: number;
}

interface ShiftWithCoords extends Shift {
  coords: Coords;
}

interface LocationPin {
  address: string;
  position: Coords;
  shifts: Shift[];
}

const containerStyle = {
  width: '100%',
  height: '500px',
};

// This is the location for Broad Oak Group, to be used as the home point.
const broadOakGroupLocation = {
  lat: 53.0186,
  lng: -1.9775
};

const homeIcon = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="%233F51B5" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`;


// Haversine formula to calculate distance between two lat/lng points in miles
const haversineDistance = (coords1: Coords, coords2: Coords): number => {
    const toRad = (x: number) => (x * Math.PI) / 180;
    const R = 3959; // Earth's radius in miles

    const dLat = toRad(coords2.lat - coords1.lat);
    const dLon = toRad(coords2.lng - coords1.lng);
    const lat1 = toRad(coords1.lat);
    const lat2 = toRad(coords2.lat);

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
};


export function StaffShiftMap() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [geocodedLocations, setGeocodedLocations] = useState<Map<string, Coords>>(new Map());
  const [selectedPin, setSelectedPin] = useState<LocationPin | null>(null);

  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!,
  });

  useEffect(() => {
    const loadShifts = async () => {
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
        setShifts(shiftsData);
      } catch (error) {
        console.error("Failed to load shifts:", error);
      } finally {
        setLoading(false);
      }
    };

    loadShifts();
  }, []);

  const geocodeAddress = useCallback((geocoder: google.maps.Geocoder, address: string) => {
    return new Promise<Coords | null>((resolve) => {
        geocoder.geocode({ address: `${address}, UK` }, (results, status) => {
            if (status === 'OK' && results && results[0]) {
                const location = results[0].geometry.location;
                resolve({ lat: location.lat(), lng: location.lng() });
            } else {
                if (status !== 'ZERO_RESULTS') {
                    console.warn('Geocode was not successful for the following reason: ' + status);
                }
                resolve(null);
            }
        });
    });
  }, []);

  useEffect(() => {
    if (!isLoaded || shifts.length === 0) return;

    const geocoder = new window.google.maps.Geocoder();
    const uniqueAddresses = [...new Set(shifts.map(s => s.address).filter(Boolean))];
    
    const geocodePromises = uniqueAddresses.map(async (address) => {
        if (!geocodedLocations.has(address)) {
            const coords = await geocodeAddress(geocoder, address);
            if (coords) {
                return { address, coords };
            }
        }
        return null;
    });

    Promise.all(geocodePromises).then(results => {
        setGeocodedLocations(prev => {
            const newCache = new Map(prev);
            results.forEach(result => {
                if (result) {
                    newCache.set(result.address, result.coords);
                }
            });
            return newCache;
        });
    });
  }, [isLoaded, shifts, geocodedLocations, geocodeAddress]);

  const locationPins = useMemo((): LocationPin[] => {
    const shiftsWithCoords = shifts.map(shift => {
        const coords = geocodedLocations.get(shift.address);
        return coords ? { ...shift, coords } : null;
    }).filter((s): s is ShiftWithCoords => s !== null);

    const shiftsByAddress = new Map<string, { shifts: Shift[], coords: Coords }>();
    shiftsWithCoords.forEach(shift => {
        if (!shiftsByAddress.has(shift.address)) {
            shiftsByAddress.set(shift.address, { shifts: [], coords: shift.coords });
        }
        shiftsByAddress.get(shift.address)!.shifts.push(shift);
    });
      
    return Array.from(shiftsByAddress.entries()).map(([address, data]) => ({
      address,
      position: data.coords,
      shifts: data.shifts,
    }));
  }, [shifts, geocodedLocations]);

  const closestUsersForSelectedPin = useMemo(() => {
    if (!selectedPin) return [];

    const otherPins = locationPins.filter(p => p.address !== selectedPin.address);
    const distances: {userName: string, distance: number}[] = [];

    otherPins.forEach(otherPin => {
        otherPin.shifts.forEach(shift => {
            const distance = haversineDistance(selectedPin.position, otherPin.position);
            distances.push({ userName: shift.userName || 'Unknown User', distance });
        });
    });

    const uniqueUsers = Array.from(new Set(distances.map(d => d.userName)))
        .map(name => {
            return distances.find(d => d.userName === name)!
        })
        .sort((a,b) => a.distance - b.distance);
    
    return uniqueUsers.slice(0, 4);

  }, [selectedPin, locationPins]);


  if (loadError) {
    return <div className="h-[500px] flex items-center justify-center bg-muted rounded-md text-destructive">Error loading maps. Please check your API key.</div>;
  }
  
  if (!isLoaded || loading) {
    return <div className="h-[500px] flex items-center justify-center bg-muted rounded-md"><Spinner size="lg" /></div>;
  }
  
  if (locationPins.length === 0) {
      return <div className="h-[500px] flex items-center justify-center bg-muted rounded-md">No shift locations to display for today.</div>;
  }

  return (
    <GoogleMap
      mapContainerStyle={containerStyle}
      center={broadOakGroupLocation}
      zoom={15}
    >
      <Marker
        position={broadOakGroupLocation}
        title="Broad Oak Group"
        icon={{
          url: homeIcon,
          scaledSize: new window.google.maps.Size(40, 40),
        }}
      />
      {locationPins.map((pin) => (
        <Marker 
            key={pin.address} 
            position={pin.position} 
            onClick={() => setSelectedPin(pin)}
        />
      ))}

      {selectedPin && (
        <InfoWindow
          position={selectedPin.position}
          onCloseClick={() => setSelectedPin(null)}
        >
          <div className="space-y-2 p-1 max-w-xs">
            <h4 className="font-bold text-base">{selectedPin.address}</h4>
            <hr />
            <div>
              <p className="font-semibold">Operatives at this location:</p>
              <ul className="list-none p-0 mt-1 text-sm">
                  {selectedPin.shifts.map(s => (
                      <li key={s.id}><strong>{s.userName}:</strong> {s.task}</li>
                  ))}
              </ul>
            </div>
            {closestUsersForSelectedPin.length > 0 && (
                <div>
                    <hr className="my-2" />
                    <p className="font-semibold">Closest Operatives:</p>
                    <ul className="list-none p-0 mt-1 text-sm text-muted-foreground">
                      {closestUsersForSelectedPin.map((u, i) => (
                          <li key={i}>{u.userName} (~{u.distance.toFixed(1)} miles away)</li>
                      ))}
                    </ul>
                </div>
            )}
          </div>
        </InfoWindow>
      )}
    </GoogleMap>
  );
}
