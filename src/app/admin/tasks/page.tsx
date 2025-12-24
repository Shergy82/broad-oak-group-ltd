'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckSquare } from 'lucide-react';

export default function TasksPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Task Management</CardTitle>
        <CardDescription>
          This is the page for managing tasks. You can build out this feature here.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
            <CheckSquare className="mx-auto h-12 w-12 text-muted-foreground" />
            <h3 className="mt-4 text-lg font-semibold">Tasks Page</h3>
            <p className="mt-2 text-sm text-muted-foreground">
                This section is under construction.
            </p>
        </div>
      </CardContent>
    </Card>
  );
}
