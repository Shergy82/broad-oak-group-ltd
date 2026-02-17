'use client';

import { useState, useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { GoogleMap, Marker, InfoWindow, useJsApiLoader } from '@react-google-maps/api';
import { findLocalMerchants, type Merchant } from '@/app/actions';
import { Spinner } from '@/components/shared/spinner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { List, MapIcon, Search, AlertTriangle } from 'lucide-react';

const UK_CENTER = { lat: 54.5, lng: -2 };
const containerStyle = {
  width: '100%',
  height: '400px',
};

type FormData = {
  query: string;
};

export function MerchantFinder() {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number, lng: number } | null>(null);
  const [activeMarker, setActiveMarker] = useState<number | null>(null);
  const { register, handleSubmit } = useForm<FormData>();
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!,
  });

  useEffect(() => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      () => {
        setError("Location access denied. Using a default location.");
        setUserLocation(UK_CENTER);
      }
    );
  }, []);

  const onSubmit = async (data: FormData) => {
    if (!userLocation) {
        setError("Could not determine your location. Please enable location services.");
        return;
    }
    setLoading(true);
    setError(null);
    setMerchants([]);
    const result = await findLocalMerchants({ ...data, ...userLocation });
    setLoading(false);
    if (result.error) {
      setError(result.error);
    } else if (result.merchants) {
      setMerchants(result.merchants);
    }
  };
  
  const mapCenter = useMemo(() => {
    if (merchants.length > 0) {
      return merchants[0]; // Center on the first result
    }
    return userLocation || UK_CENTER;
  }, [userLocation, merchants]);

  if (loadError) {
    return <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Map Error</AlertTitle><AlertDescription>Could not load Google Maps. Please check your API key configuration.</AlertDescription></Alert>;
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit(onSubmit)} className="flex items-center gap-2">
        <div className="relative flex-grow">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input {...register('query')} placeholder="e.g., plumbers, coffee shops..." className="pl-10" />
        </div>
        <Button type="submit" disabled={loading || !isLoaded}>
          {loading ? <Spinner /> : 'Search'}
        </Button>
      </form>

      {error && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Error</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}

      <div className="grid md:grid-cols-2 gap-6">
        <div className="space-y-4">
            <h3 className="font-semibold flex items-center gap-2"><MapIcon /> Map View</h3>
            <div className="h-[400px] bg-muted rounded-lg flex items-center justify-center">
                 {!isLoaded ? (
                    <Spinner size="lg" />
                 ) : (
                    <GoogleMap mapContainerStyle={containerStyle} center={mapCenter} zoom={12}>
                        {userLocation && <Marker position={userLocation} title="Your Location" icon={{ path: google.maps.SymbolPath.CIRCLE, scale: 7, fillColor: '#4285F4', fillOpacity: 1, strokeColor: 'white', strokeWeight: 2 }} />}
                        {merchants.map((merchant, index) => (
                            <Marker key={index} position={{ lat: merchant.lat, lng: merchant.lng }} onClick={() => setActiveMarker(index)} />
                        ))}
                        {activeMarker !== null && merchants[activeMarker] && (
                            <InfoWindow position={{ lat: merchants[activeMarker].lat, lng: merchants[activeMarker].lng }} onCloseClick={() => setActiveMarker(null)}>
                                <div>
                                    <h4 className="font-bold">{merchants[activeMarker].name}</h4>
                                    <p className="text-sm">{merchants[activeMarker].address}</p>
                                </div>
                            </InfoWindow>
                        )}
                    </GoogleMap>
                 )}
            </div>
        </div>
        <div className="space-y-4">
            <h3 className="font-semibold flex items-center gap-2"><List /> Results</h3>
            <div className="h-[400px] border rounded-lg overflow-y-auto p-2">
                {loading && <div className="flex items-center justify-center h-full"><Spinner size="lg"/></div>}
                {!loading && merchants.length === 0 && (
                    <div className="flex items-center justify-center h-full text-muted-foreground text-center p-4">
                       <p>Your search results will appear here. The AI will generate fictional merchants based on your query.</p>
                    </div>
                )}
                <div className="space-y-2">
                    {merchants.map((merchant, index) => (
                        <div key={index} className="p-3 border rounded-md hover:bg-muted/50 cursor-pointer" onMouseEnter={() => setActiveMarker(index)} onMouseLeave={() => setActiveMarker(null)}>
                            <p className="font-semibold">{merchant.name}</p>
                            <p className="text-sm text-muted-foreground">{merchant.address}</p>
                             <p className="text-xs text-muted-foreground capitalize pt-1">{merchant.category}</p>
                        </div>
                    ))}
                </div>
            </div>
        </div>
      </div>
    </div>
  );
}
