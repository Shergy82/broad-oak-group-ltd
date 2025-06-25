
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { KeyRound, ClipboardCopy } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Spinner } from '@/components/shared/spinner';
import { generateVapidKeysAction } from '@/app/admin/actions';

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

  const firebaseConfigCommand = keys ? `npx firebase functions:config:set webpush.public_key="${keys.publicKey}" webpush.private_key="${keys.privateKey}"` : '';
  const envVarLine = keys ? `NEXT_PUBLIC_VAPID_PUBLIC_KEY="${keys.publicKey}"` : '';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Push Notification VAPID Keys</CardTitle>
        <CardDescription>
          Generate the keys required for sending push notifications. You only need to do this once.
          After generating, follow the steps in the <code>PUSH_NOTIFICATIONS_GUIDE.md</code> file to complete the setup.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!keys ? (
          <Button onClick={handleGenerateKeys} disabled={isLoading}>
            {isLoading ? <Spinner /> : <><KeyRound className="mr-2" /> Generate Keys</>}
          </Button>
        ) : (
          <div className="space-y-6 rounded-lg border bg-muted/50 p-4">
            <div className="space-y-2">
              <h3 className="font-semibold text-lg">Keys Generated Successfully</h3>
              <p className="text-sm text-muted-foreground">Follow these steps to configure your app and server. If a copy button fails, manually select the text below and press Ctrl+C (or Cmd+C).</p>
            </div>
            
            <div className="space-y-2">
              <h4 className="font-semibold">Step 1: Configure the App</h4>
              <p className="text-xs text-muted-foreground">
                Copy the full line below and paste it into your <code>.env.local</code> file. If the file doesn't exist, create it. <strong className="text-destructive">You must restart the server after saving this file.</strong>
              </p>
              <div className="flex w-full items-start gap-2">
                <pre className="flex-1 font-mono text-xs bg-background p-3 rounded-md border overflow-x-auto whitespace-pre-wrap break-all">
                  <code>{envVarLine}</code>
                </pre>
                <Button variant="outline" size="sm" onClick={() => copyToClipboard(envVarLine, 'Environment variable line')} className="shrink-0">
                  <ClipboardCopy className="mr-2" />
                  Copy
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="font-semibold">Step 2: Configure the Server</h4>
               <p className="text-xs text-muted-foreground">
                The Private Key is a secret. Run the following Firebase CLI command in your terminal to store both keys securely for your server-side function.
              </p>
              <div className="flex w-full items-start gap-2">
                <pre className="flex-1 font-mono text-xs bg-background p-3 rounded-md border overflow-x-auto whitespace-pre-wrap break-all">
                    <code>{firebaseConfigCommand}</code>
                </pre>
                <Button variant="outline" size="sm" onClick={() => copyToClipboard(firebaseConfigCommand, 'Firebase CLI command')} className="shrink-0">
                  <ClipboardCopy className="mr-2" />
                  Copy
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
