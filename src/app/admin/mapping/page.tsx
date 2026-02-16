'use client';

import { ShiftMap } from '@/components/admin/shift-map';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function MappingPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Shift Map</CardTitle>
        <CardDescription>
          A map overview of all currently scheduled shifts that have been geocoded.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ShiftMap />
      </CardContent>
    </Card>
  );
}
