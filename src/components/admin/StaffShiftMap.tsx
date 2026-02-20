
'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { GoogleMap, Marker, InfoWindow, useJsApiLoader } from '@react-google-maps/api';
import { collection, onSnapshot, query, where, Timestamp } from 'firebase/firestore';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search } from 'lucide-react';

import { db } from '@/lib/firebase';
import type { Shift, UserProfile, ShiftStatus } from '@/types';
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
  color: string;
}

const statusColorMapping: { [key in ShiftStatus]: string } = {
    'on-site': '#14b8a6', // teal
    'confirmed': '#3F51B5', // primary/blue
    'pending-confirmation': '#FBBF24', // yellow
    'completed': '#22c55e', // green
    'incomplete': '#ef4444', // red
    'rejected': '#ef4444', // red
};

const statusPriority: ShiftStatus[] = [
    'on-site',
    'confirmed',
    'pending-confirmation',
    'incomplete',
    'rejected',
    'completed',
];

const UK_CENTER = { lat: 54.5, lng: -2 };

const containerStyle = {
  width: '100%',
  height: '500px',
};


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
  const [mapCenter, setMapCenter] = useState(UK_CENTER);
  const [userLocation, setUserLocation] = useState<Coords | null>(null);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);

  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!,
  });

  useEffect(() => {
    if (!db) {
      setLoading(false);
      return;
    }
    setLoading(true);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const shiftsQuery = query(
      collection(db, 'shifts'),
      where('date', '>=', Timestamp.fromDate(todayStart)),
      where('date', '<=', Timestamp.fromDate(todayEnd))
    );

    const unsubscribe = onSnapshot(shiftsQuery, (snapshot) => {
      const shiftsData = snapshot.docs.map(doc => ({id: doc.id, ...doc.data()} as Shift));
      setShifts(shiftsData);
      setLoading(false);
    }, (error) => {
      console.error("Failed to load shifts:", error);
      setLoading(false);
    });

    return () => unsubscribe();
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
        const newResults = results.filter(Boolean); // Filter out nulls
        if (newResults.length > 0) { // Only update if there are new results
            setGeocodedLocations(prev => {
                const newCache = new Map(prev);
                newResults.forEach(result => {
                    if (result) {
                        newCache.set(result.address, result.coords);
                    }
                });
                return newCache;
            });
        }
    });
  }, [isLoaded, shifts, geocodedLocations, geocodeAddress]);

  useEffect(() => {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const currentLocation = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                };
                setUserLocation(currentLocation);
                setMapCenter(currentLocation);
            },
            () => {
                // Fallback to UK center if location is denied or fails
                setMapCenter(UK_CENTER);
            }
        );
    }
  }, []);

  const usersWithShifts = useMemo(() => {
    const users: { [key: string]: string } = {};
    shifts.forEach(shift => {
        if (shift.userId && shift.userName) {
            users[shift.userId] = shift.userName;
        }
    });
    return Object.entries(users).map(([uid, name]) => ({ uid, name })).sort((a,b) => a.name.localeCompare(b.name));
  }, [shifts]);

  const handleUserSelect = (userId: string) => {
    if (userId === 'all') {
        setSelectedUser(null);
        setMapCenter(userLocation || UK_CENTER);
        return;
    }

    setSelectedUser(userId);
    const userShift = shifts.find(s => s.userId === userId);
    if (userShift) {
        const coords = geocodedLocations.get(userShift.address);
        if (coords) {
            setMapCenter(coords);
        }
    }
  };

  const locationPins = useMemo((): LocationPin[] => {
    const shiftsToProcess = selectedUser ? shifts.filter(s => s.userId === selectedUser) : shifts;

    const shiftsWithCoords = shiftsToProcess.map(shift => {
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
      
    return Array.from(shiftsByAddress.entries()).map(([address, data]) => {
        let highestPriorityStatus: ShiftStatus | null = null;
        let highestPriorityIndex = Infinity;

        data.shifts.forEach(shift => {
            const priority = statusPriority.indexOf(shift.status);
            if (priority !== -1 && priority < highestPriorityIndex) {
                highestPriorityIndex = priority;
                highestPriorityStatus = shift.status;
            }
        });

        const pinColor = highestPriorityStatus ? statusColorMapping[highestPriorityStatus] : '#6b7280'; // default gray

        return {
            address,
            position: data.coords,
            shifts: data.shifts,
            color: pinColor
        };
    });
  }, [shifts, geocodedLocations, selectedUser]);

  const closestUsersForSelectedPin = useMemo(() => {
    if (!selectedPin) return [];

    const usersAtSelectedPin = new Set(selectedPin.shifts.map(s => s.userName));

    const otherPins = locationPins.filter(p => p.address !== selectedPin.address);
    const distances: {userName: string, distance: number}[] = [];

    otherPins.forEach(otherPin => {
        otherPin.shifts.forEach(shift => {
            if (shift.userName && !usersAtSelectedPin.has(shift.userName)) {
                const distance = haversineDistance(selectedPin.position, otherPin.position);
                distances.push({ userName: shift.userName, distance });
            }
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
  
  if (locationPins.length === 0 && !userLocation) {
      return <div className="h-[500px] flex items-center justify-center bg-muted rounded-md">No shift locations to display for today.</div>;
  }

  return (
    <div className="space-y-4">
        <div className="flex items-center gap-2">
            <Search className="h-5 w-5 text-muted-foreground" />
            <Select onValueChange={handleUserSelect} value={selectedUser || 'all'}>
                <SelectTrigger className="w-full sm:w-[300px]">
                    <SelectValue placeholder="Search for an operative..." />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">Show All Operatives</SelectItem>
                    {usersWithShifts.map(user => (
                        <SelectItem key={user.uid} value={user.uid}>{user.name}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
        <div className="relative">
            <GoogleMap
            mapContainerStyle={containerStyle}
            center={mapCenter}
            zoom={12}
            >
            {userLocation && !selectedUser && (
                <Marker
                    position={userLocation}
                    title="Your Location"
                    icon={{
                        path: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z',
                        fillColor: '#1a73e8', // A distinct blue for the user's location
                        fillOpacity: 1,
                        strokeWeight: 1,
                        strokeColor: '#ffffff',
                        scale: 1.5,
                        anchor: typeof window !== 'undefined' ? new window.google.maps.Point(12, 24) : undefined
                    }}
                />
            )}
            {locationPins.map((pin) => (
                <Marker 
                    key={pin.address} 
                    position={pin.position} 
                    onMouseOver={() => setSelectedPin(pin)}
                    onMouseOut={() => setSelectedPin(null)}
                    icon={{
                        path: google.maps.SymbolPath.CIRCLE,
                        scale: 15,
                        fillColor: pin.color,
                        fillOpacity: 1,
                        strokeColor: '#ffffff',
                        strokeWeight: 2,
                    }}
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
                            <li key={s.id}>
                                <strong>{s.userName}:</strong> {s.task} -{' '}
                                <span
                                    style={{ color: statusColorMapping[s.status] || '#6b7280' }}
                                    className="font-semibold capitalize"
                                >
                                    {s.status.replace(/-/g, ' ')}
                                </span>
                            </li>
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
            <div className="absolute bottom-3 left-3 bg-white p-2 rounded shadow-lg space-y-1 text-xs z-10">
                <h4 className="font-bold">Status Legend</h4>
                {Object.entries(statusColorMapping).filter(([status]) => status !== 'rejected').map(([status, color]) => (
                <div key={status} className="flex items-center gap-2">
                    <div style={{ backgroundColor: color }} className="w-3 h-3 rounded-full border border-gray-300"></div>
                    <span className="capitalize">{status.replace('-', ' ')}</span>
                </div>
                ))}
            </div>
        </div>
    </div>
  );
}
