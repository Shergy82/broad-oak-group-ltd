'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Paintbrush } from 'lucide-react';

export default function ControlPanelPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Admin Control Panel</CardTitle>
        <CardDescription>
          This is a placeholder page for your admin controls.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 text-center h-96">
          <Paintbrush className="mx-auto h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-semibold">Ready for Content</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            This page is now loading correctly.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
