
'use client';

import { MerchantFinder } from '@/components/ai/merchant-finder';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function AiAssistantPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>AI Merchant Finder</CardTitle>
        <CardDescription>
          Find local merchants and services near you using AI. Enter a search query below.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <MerchantFinder />
      </CardContent>
    </Card>
  );
}
