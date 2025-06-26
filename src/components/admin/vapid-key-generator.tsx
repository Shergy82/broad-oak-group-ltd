
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { KeyRound, ClipboardCopy, Server, UploadCloud } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Spinner } from '@/components/shared/spinner';
import { generateVapidKeysAction } from '@/app/admin/actions';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export function VapidKeyGenerator() {
  const [keys, setKeys] = useState<{ publicKey: string; privateKey: string } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleGenerateKeys = async () => {
    setIsLoading(true);
    try {
      const newKeys = await generateVapidKeysAction();
      setKeys(newKeys);
    } catch (error) {
        console.error("Error generating VAPID keys:", error);
        toast({
            variant: 'destructive',
            title: 'Generation Failed',
            description: 'Could not generate VAPID keys on the server. Please try again.',
        });
    } finally {
        setIsLoading(false);
    }
  };
  
  const copyToClipboard = (text: string, itemName: string) => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            toast({
                title: 'Copied to Clipboard',
                description: `${itemName} has been copied.`,
            });
        }).catch(err => {
            console.error('Failed to copy text: ', err);
            toast({
                variant: 'destructive',
                title: 'Copy Failed',
                description: 'Could not copy to clipboard. Please select the text and copy it manually.',
            });
        });
    } else {
        toast({
            variant: 'destructive',
            title: 'Clipboard Unavailable',
            description: 'Please select the text and copy it manually. This browser does not support the Clipboard API.',
        });
    }
  };

  const firebaseConfigCommand = keys ? `npx firebase functions:config:set WEBPUSH_PUBLIC_KEY="${keys.publicKey}" WEBPUSH_PRIVATE_KEY="${keys.privateKey}"` : '';
  const deployCommand = 'npx firebase deploy --only functions';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Push Notification VAPID Keys</CardTitle>
        <CardDescription>
          Generate and configure the keys required for sending push notifications. This is a one-time setup.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!keys ? (
          <Button onClick={handleGenerateKeys} disabled={isLoading}>
            {isLoading ? <Spinner /> : <><KeyRound className="mr-2" /> Generate Keys</>}
          </Button>
        ) : (
          <div className="space-y-4">
            <Alert>
              <Server className="h-4 w-4" />
              <AlertTitle>Step 1: Configure the Server</AlertTitle>
              <AlertDescription>
                <p className="mb-2">Click the "Copy" button below to copy the complete command, then paste it into your terminal and press Enter. This stores your secret keys on the server.</p>
                <div className="flex w-full items-start gap-2">
                  <pre className="flex-1 font-mono text-xs bg-muted p-3 rounded-md border overflow-x-auto whitespace-pre-wrap break-all">
                      <code>{firebaseConfigCommand}</code>
                  </pre>
                  <Button variant="outline" size="sm" onClick={() => copyToClipboard(firebaseConfigCommand, 'Firebase CLI command')} className="shrink-0">
                    <ClipboardCopy className="mr-2" />
                    Copy
                  </Button>
                </div>
              </AlertDescription>
            </Alert>

            <Alert>
              <UploadCloud className="h-4 w-4" />
              <AlertTitle>Step 2: Deploy Your Functions</AlertTitle>
              <AlertDescription>
                <p className="mb-2">After Step 1 is successful, copy and run this second command to deploy your backend code with the new keys.</p>
                 <div className="flex w-full items-start gap-2">
                    <pre className="flex-1 font-mono text-xs bg-muted p-3 rounded-md border overflow-x-auto whitespace-pre-wrap break-all">
                        <code>{deployCommand}</code>
                    </pre>
                    <Button variant="outline" size="sm" onClick={() => copyToClipboard(deployCommand, 'Deploy command')} className="shrink-0">
                      <ClipboardCopy className="mr-2" />
                      Copy
                    </Button>
                  </div>
              </AlertDescription>
            </Alert>
             <p className="text-xs text-center text-muted-foreground pt-4">
                After deploying, refresh the application. The notification bell in the header should become active.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
