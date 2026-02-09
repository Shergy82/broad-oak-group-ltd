'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FileArchive } from 'lucide-react';

export default function EvidencePage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Evidence</CardTitle>
        <CardDescription>
          This is the new Evidence page. You can populate it with content later.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 text-center h-96">
            <FileArchive className="mx-auto h-12 w-12 text-muted-foreground" />
            <h3 className="mt-4 text-lg font-semibold">Evidence Page</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Ready for your content.
            </p>
          </div>
      </CardContent>
    </Card>
  );
}
