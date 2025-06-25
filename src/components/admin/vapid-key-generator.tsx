'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { KeyRound } from 'lucide-react';
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
            description: 'Could not copy to clipboard. Please copy the text manually.',
        });
    });
  };

  const firebaseConfigCommand = keys ? `firebase functions:config:set webpush.public_key="${keys.publicKey}" webpush.private_key="${keys.privateKey}"` : '';

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
              <p className="text-sm text-muted-foreground">Follow these steps to configure your app and server.</p>
            </div>
            
            <div className="space-y-2">
              <label className="font-mono text-sm font-semibold text-green-600 dark:text-green-400">Step 1: Configure the App</label>
              <p className="text-xs text-muted-foreground">
                Copy the Public Key and add it to your <code>.env.local</code> file as <code>NEXT_PUBLIC_VAPID_PUBLIC_KEY</code>.
              </p>
              <div className="flex gap-2 items-center rounded-md bg-background p-2 border">
                <pre className="text-xs font-mono overflow-x-auto flex-grow">{keys.publicKey}</pre>
                <Button variant="outline" size="sm" onClick={() => copyToClipboard(keys.publicKey, 'Public Key')}>Copy Key</Button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="font-mono text-sm font-semibold text-orange-600 dark:text-orange-400">Step 2: Configure the Server</label>
               <p className="text-xs text-muted-foreground">
                The Private Key is a secret. Run the following Firebase CLI command in your terminal to store both keys securely for your server-side function.
              </p>
              <div className="flex gap-2 items-center rounded-md bg-background p-2 border">
                <pre className="text-xs font-mono overflow-x-auto flex-grow">{firebaseConfigCommand}</pre>
                <Button variant="outline" size="sm" onClick={() => copyToClipboard(firebaseConfigCommand, 'Firebase CLI command')}>Copy Command</Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
