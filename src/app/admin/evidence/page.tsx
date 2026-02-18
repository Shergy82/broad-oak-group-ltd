'use client';

import { EvidenceDashboard } from '@/components/admin/evidence-dashboard';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export default function EvidencePage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Evidence Dashboard</CardTitle>
        <CardDescription>
          Overview of all project sites. New sites from imports will appear here.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <EvidenceDashboard />
      </CardContent>
    </Card>
  );
}
