
'use client';

import { httpsCallable, functions } from '@/lib/firebase';
import { getAuth } from 'firebase/auth';
import { Button } from '@/components/ui/button';
import { useState } from 'react';

export function ReGeocodeButton() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const run = async () => {
    const auth = getAuth();
    if (!auth.currentUser) {
      alert('You must be logged in');
      return;
    }

    setLoading(true);
    try {
      const fn = httpsCallable(functions, 'reGeocodeAllShifts');
      const res = await fn({});
      setResult(res.data);
      alert(JSON.stringify(res.data, null, 2));
    } catch (err: any) {
      alert(err.message || 'Failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <Button
        variant="destructive"
        disabled={loading}
        onClick={run}
      >
        {loading ? 'Re-geocoding…' : 'Re-Geocode All Shifts'}
      </Button>

      {result && (
        <pre className="text-xs bg-muted p-2 rounded">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}
