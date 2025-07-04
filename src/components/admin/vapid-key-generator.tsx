
'use client';

import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { functions, httpsCallable } from '@/lib/firebase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Terminal, CheckCircle, HelpCircle, Loader2, Copy } from 'lucide-react';
import { Button } from '../ui/button';

export function VapidKeyGenerator() {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const fetchKey = async () => {
      if (!functions) {
        setError("Firebase is not configured.");
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      try {
        const getVapidKey = httpsCallable(functions, 'getVapidPublicKey');
        const result = await getVapidKey() as { data: { publicKey: string } };
        setPublicKey(result.data.publicKey);
        setError(null);
      } catch (err: any) {
        if (err.code === 'failed-precondition') {
          setError("VAPID keys are not configured on the server. Follow the steps below.");
          setPublicKey(null);
        } else {
          setError(`An unexpected error occurred: ${err.message}`);
          setPublicKey(null);
        }
      } finally {
        setIsLoading(false);
      }
    };
    fetchKey();
  }, []);

  const cliCommand = "firebase functions:config:set webpush.public_key='YOUR_PUBLIC_KEY' webpush.private_key='YOUR_PRIVATE_KEY'";

  const copyToClipboard = () => {
    navigator.clipboard.writeText(cliCommand);
    toast({
      title: "Copied to Clipboard",
      description: "The CLI command has been copied.",
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>VAPID Key Status</CardTitle>
        <CardDescription>
          These keys are required for sending push notifications. This panel checks if they are configured on the server.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="animate-spin" /> Checking server configuration...
          </div>
        ) : publicKey ? (
          <Alert variant="default" className="border-green-500">
            <CheckCircle className="h-4 w-4 text-green-500" />
            <AlertTitle>Configuration Complete</AlertTitle>
            <AlertDescription>
              A VAPID public key is configured on the server. Push notifications are enabled.
              <p className="text-xs font-mono mt-2 p-2 bg-muted rounded truncate">{publicKey}</p>
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-4">
             <Alert variant="destructive">
                <HelpCircle className="h-4 w-4" />
                <AlertTitle>Action Required: Configure VAPID Keys</AlertTitle>
                <AlertDescription>
                    {error}
                </AlertDescription>
            </Alert>
            <div className="space-y-2 text-sm">
                <p>To enable push notifications, you must generate VAPID keys and set them as environment configuration for your Cloud Functions.</p>
                <ol className="list-decimal list-inside space-y-2 pl-2">
                    <li>Open a terminal and run this command: <br/><code className="text-xs bg-muted p-1 rounded">npm install -g web-push</code></li>
                    <li>Next, run this command to generate your keys: <br/><code className="text-xs bg-muted p-1 rounded">web-push generate-vapid-keys</code></li>
                    <li>This will output a Public Key and a Private Key. Copy them.</li>
                    <li>
                        In your project's root folder in the terminal, run the command below, replacing the placeholders with your keys.
                        <div className="relative mt-2">
                            <pre className="p-4 bg-muted rounded-md text-xs overflow-x-auto pr-12">{cliCommand}</pre>
                            <Button variant="ghost" size="icon" className="absolute top-2 right-2 h-7 w-7" onClick={copyToClipboard}>
                                <Copy className="h-4 w-4" />
                            </Button>
                        </div>
                    </li>
                    <li>Finally, redeploy your functions to apply the new configuration:<br/> <code className="text-xs bg-muted p-1 rounded">firebase deploy --only functions</code></li>
                </ol>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
