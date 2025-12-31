'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Paintbrush } from 'lucide-react';

export default function ControlPanelPage() {
  return (
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <CardTitle>Control Panel</CardTitle>
          <CardDescription>
            This is your new control panel. You can now add the components and features you need.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 text-center h-96">
            <Paintbrush className="mx-auto h-12 w-12 text-muted-foreground" />
            <h3 className="mt-4 text-lg font-semibold">Blank Canvas</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Ready for your next great idea!
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
