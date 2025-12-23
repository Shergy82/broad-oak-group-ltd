
'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CalendarCheck } from 'lucide-react';

export function AvailabilityOverview() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Operative Availability</CardTitle>
        <CardDescription>
          View and manage operative availability, time off, and holidays.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center h-96">
            <CalendarCheck className="mx-auto h-12 w-12 text-muted-foreground" />
            <h3 className="mt-4 text-lg font-semibold">Under Construction</h3>
            <p className="mt-2 text-sm text-muted-foreground">
                The availability calendar and management tools will be displayed here.
            </p>
        </div>
      </CardContent>
    </Card>
  );
}
