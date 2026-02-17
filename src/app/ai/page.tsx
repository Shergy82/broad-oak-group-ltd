'use client';

import { useState, useEffect } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import { Spinner } from '@/components/shared/spinner';

export default function AIAssistantPage() {
  const [query, setQuery] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!navigator.geolocation) {
      setError('Geolocation not supported.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoords({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      () => {
        setError('Location permission denied.');
      }
    );
  }, []);

  const handleSearch = async () => {
    if (!query) return;

    if (!coords) {
      setError('Location not available yet.');
      return;
    }

    try {
      setLoading(true);
      setError('');
      setResults([]);

      const findMerchants = httpsCallable(functions, 'aiMerchantFinder');

      const res: any = await findMerchants({
        message: query,
        lat: coords.lat,
        lng: coords.lng,
      });

      setResults(res.data.results || []);
    } catch (err) {
      console.error(err);
      setError('Unable to fetch merchants.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">AI Assistant</h1>
        <p className="text-gray-600">
          Search for trusted trades and suppliers instantly.
        </p>
      </div>

      {/* Responsive Search Section */}
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. plumber, electrician, roofing contractor"
          className="w-full border rounded px-4 py-3 text-base"
        />

        <button
          onClick={handleSearch}
          className="w-full sm:w-auto bg-black text-white px-6 py-3 rounded"
        >
          Search
        </button>
      </div>

      {loading && <Spinner size="sm" />}

      {error && <div className="text-red-500">{error}</div>}

      {results.length > 0 && (
        <div className="space-y-4">
          {results.map((m, i) => (
            <div key={i} className="border rounded p-4 space-y-2">
              <div className="font-semibold text-lg">{m.name}</div>
              <div>⭐ {m.rating ?? 'N/A'}</div>
              <div>{m.address}</div>
              <a
                href={m.mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 underline"
              >
                View on Maps
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
