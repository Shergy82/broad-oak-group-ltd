
'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { GoogleMap, Marker, InfoWindow, useJsApiLoader } from '@react-google-maps/api';
import { collection, onSnapshot, query, where, Timestamp } from 'firebase/firestore';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search } from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';


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
  icon: any;
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

const getInitials = (name?: string) => {
    if (!name) return '??';
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase();
};

const shortenAddress = (address?: string) => {
    if (!address) return '';
    return address.split(',')[0];
};


export function StaffShiftMap() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [geocodedLocations, setGeocodedLocations] = useState<Map<string, Coords>>(new Map());
  const [hoveredPin, setHoveredPin] = useState<LocationPin | null>(null);
  const [clickedPin, setClickedPin] = useState<LocationPin | null>(null);
  const [mapCenter, setMapCenter] = useState(UK_CENTER);
  const [userLocation, setUserLocation] = useState<Coords | null>(null);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const infoWindowCloseTimer = useRef<NodeJS.Timeout | null>(null);


  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!,
  });

  const activePin = useMemo(() => clickedPin || hoveredPin, [clickedPin, hoveredPin]);

  const handleMarkerMouseOver = (pin: LocationPin) => {
    if (infoWindowCloseTimer.current) {
        clearTimeout(infoWindowCloseTimer.current);
    }
    // Only show hover if no pin is clicked
    if (!clickedPin) {
        setHoveredPin(pin);
    }
  };

  const handleMarkerMouseOut = () => {
    infoWindowCloseTimer.current = setTimeout(() => {
        setHoveredPin(null);
    }, 100);
  };
  
  const handleMarkerClick = (pin: LocationPin) => {
      // If clicking the currently clicked pin, unclick it. Otherwise, set the new clicked pin.
      if (clickedPin && clickedPin.address === pin.address) {
          setClickedPin(null);
      } else {
          setClickedPin(pin);
          setHoveredPin(null); // Clear any hover state
      }
  };

  const handleInfoWindowClose = () => {
      setClickedPin(null);
      setHoveredPin(null);
  };

  const handleInfoWindowMouseOver = () => {
      if (infoWindowCloseTimer.current) {
          clearTimeout(infoWindowCloseTimer.current);
      }
  };
  
  const handleInfoWindowMouseOut = () => {
      // Only close if it's not a clicked pin
      if (!clickedPin) {
          handleMarkerMouseOut();
      }
  };


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
    if (typeof window === 'undefined' || !window.google) return [];
    
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
        const uniqueStatuses = [...new Set(data.shifts.map(s => s.status))];
        let pinIcon: any;

        if (uniqueStatuses.length <= 1) {
            const status = uniqueStatuses[0] || 'pending-confirmation';
            const pinColor = statusColorMapping[status] || '#6b7280';
            pinIcon = {
                path: google.maps.SymbolPath.CIRCLE,
                scale: 15,
                fillColor: pinColor,
                fillOpacity: 1,
                strokeColor: '#ffffff',
                strokeWeight: 2,
            };
        } else {
            const colors = uniqueStatuses.map(status => statusColorMapping[status] || '#6b7280');
            const radius = 12;
            const center = 12;
            const total = colors.length;
            let start_angle = -90;

            const paths = colors.map(color => {
                const slice_angle = 360 / total;
                const end_angle = start_angle + slice_angle;
                
                const x1 = center + radius * Math.cos(start_angle * Math.PI / 180);
                const y1 = center + radius * Math.sin(start_angle * Math.PI / 180);

                const x2 = center + radius * Math.cos(end_angle * Math.PI / 180);
                const y2 = center + radius * Math.sin(end_angle * Math.PI / 180);

                const largeArcFlag = slice_angle > 180 ? 1 : 0;
                
                const d = `M${center},${center} L${x1},${y1} A${radius},${radius} 0 ${largeArcFlag},1 ${x2},${y2} Z`;

                start_angle = end_angle;
                return `<path d="${d}" fill="${color}" />`;
            }).join('');
            
            const svg = `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">${paths}<circle cx="12" cy="12" r="12" fill="transparent" stroke="#ffffff" stroke-width="2"/></svg>`;
            
            pinIcon = {
                url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
                scaledSize: new window.google.maps.Size(30, 30),
                anchor: new window.google.maps.Point(15, 15),
            };
        }

        return {
            address,
            position: data.coords,
            shifts: data.shifts,
            icon: pinIcon,
        };
    });
  }, [shifts, geocodedLocations, selectedUser]);

  const closestUsersForSelectedPin = useMemo(() => {
    if (!activePin) return [];

    const usersAtSelectedPin = new Set(activePin.shifts.map(s => s.userName));

    const otherPins = locationPins.filter(p => p.address !== activePin.address);
    const distances: {userName: string, distance: number}[] = [];

    otherPins.forEach(otherPin => {
        otherPin.shifts.forEach(shift => {
            if (shift.userName && !usersAtSelectedPin.has(shift.userName)) {
                const distance = haversineDistance(activePin.position, otherPin.position);
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

  }, [activePin, locationPins]);

  const shiftsByStatus = useMemo(() => {
    const grouped = new Map<ShiftStatus, Shift[]>();
    const shiftsToProcess = selectedUser ? shifts.filter(s => s.userId === selectedUser) : shifts;

    shiftsToProcess.forEach(shift => {
        if (!shift.status) return;
        if (!grouped.has(shift.status)) {
            grouped.set(shift.status, []);
        }
        grouped.get(shift.status)!.push(shift);
    });

    // Sort shifts within each group by user name
    for (const shiftArray of grouped.values()) {
        shiftArray.sort((a, b) => (a.userName || '').localeCompare(b.userName || ''));
    }

    // Sort the groups by the priority order
    const sortedGrouped = new Map([...grouped.entries()].sort((a, b) => {
        return statusPriority.indexOf(a[0]) - statusPriority.indexOf(b[0]);
    }));

    return sortedGrouped;
  }, [shifts, selectedUser]);


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
                    onMouseOver={() => handleMarkerMouseOver(pin)}
                    onMouseOut={handleMarkerMouseOut}
                    onClick={() => handleMarkerClick(pin)}
                    icon={pin.icon}
                />
            ))}

            {activePin && (
                <InfoWindow
                    position={activePin.position}
                    onCloseClick={handleInfoWindowClose}
                >
                    <div 
                        className="space-y-2 p-1 max-w-xs"
                        onMouseOver={handleInfoWindowMouseOver}
                        onMouseOut={handleInfoWindowMouseOut}
                    >
                        <h4 className="font-bold text-base">{activePin.address}</h4>
                        <hr />
                        <div>
                        <p className="font-semibold">Operatives at this location:</p>
                        <ul className="list-none p-0 mt-1 text-sm">
                            {activePin.shifts.map(s => (
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

        <div className="mt-6 pt-6 border-t">
            <h3 className="text-lg font-semibold mb-4">Live Status Report</h3>
            {shifts.length > 0 ? (
                <Accordion type="multiple" defaultValue={['on-site', 'confirmed', 'pending-confirmation']} className="w-full">
                    {Array.from(shiftsByStatus.entries()).map(([status, statusShifts]) => (
                        <AccordionItem key={status} value={status}>
                            <AccordionTrigger>
                                <div className="flex items-center gap-2">
                                    <div style={{ backgroundColor: statusColorMapping[status] || '#6b7280' }} className="w-3 h-3 rounded-full"></div>
                                    <span className="capitalize font-medium">{status.replace('-', ' ')}</span>
                                    <span className="text-sm font-normal text-muted-foreground">({statusShifts.length})</span>
                                </div>
                            </AccordionTrigger>
                            <AccordionContent>
                                <div className="flex flex-wrap gap-3 pt-2">
                                    {statusShifts.map(shift => (
                                        <div key={shift.id} className="flex items-start gap-2 p-2 border rounded-md bg-background" style={{ flexBasis: '220px' }}>
                                            <Avatar className="h-8 w-8">
                                                <AvatarFallback className="text-xs">{getInitials(shift.userName)}</AvatarFallback>
                                            </Avatar>
                                            <div className="overflow-hidden">
                                                <p className="font-semibold text-sm truncate" title={shift.userName}>{shift.userName}</p>
                                                <p className="text-xs text-muted-foreground truncate" title={shift.task}>{shift.task}</p>
                                                <p className="text-xs text-muted-foreground truncate" title={shift.address}>{shortenAddress(shift.address)}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </AccordionContent>
                        </AccordionItem>
                    ))}
                </Accordion>
            ) : (
                <p className="text-sm text-muted-foreground text-center p-4">No live shift data for today.</p>
            )}
        </div>
    </div>
  );
}
