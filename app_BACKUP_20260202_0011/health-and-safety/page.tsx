
'use client';

import { Header } from '@/components/layout/header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { HardHat, ExternalLink } from 'lucide-react';

export default function HealthAndSafetyPage() {
  const googleDriveLink = "https://drive.google.com/drive/folders/1LEJbPApqimHUHuYBuYMBtQY1anIHzj3J?usp=sharing";

  return (
    <div className="flex min-h-screen w-full flex-col">
      <Header />
      <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
        <Card>
            <CardHeader>
                <CardTitle>Health & Safety Documents</CardTitle>
                <CardDescription>
                  Access important health and safety documents from the shared folder.
                </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
                <HardHat className="mx-auto h-12 w-12 text-muted-foreground" />
                <h3 className="mt-4 text-lg font-semibold">Shared Document Folder</h3>
                <p className="mb-4 mt-2 text-sm text-muted-foreground">
                  Click the button below to open the Google Drive folder containing all relevant documents.
                </p>
                <Button asChild>
                  <a href={googleDriveLink} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Open Document Folder
                  </a>
                </Button>
              </div>
            </CardContent>
        </Card>
      </main>
    </div>
  );
}
