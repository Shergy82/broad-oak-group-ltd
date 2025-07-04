
'use client';

import { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Copy, KeyRound, Terminal } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Spinner } from '@/components/shared/spinner';

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

export function VapidKeyGenerator() {
  const [keys, setKeys] = useState<VapidKeys | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const handleGenerateKeys = async () => {
    setIsLoading(true);
    setError(null);
    setKeys(null);

    if (!functions) {
        setError("Firebase Functions is not configured. Cannot generate keys.");
        setIsLoading(false);
        return;
    }

    try {
      const generateVapidKeysFn = httpsCallable(functions, 'generateVapidKeys');
      const result = await generateVapidKeysFn();
      const generatedKeys = result.data as VapidKeys;
      
      if (!generatedKeys.publicKey || !generatedKeys.privateKey) {
        throw new Error("Received invalid keys from server.");
      }
      
      setKeys(generatedKeys);
      toast({
        title: 'Keys Generated Successfully',
        description: 'You can now proceed with the setup steps below.',
      });
    } catch (err: any) {
      console.error('Error generating VAPID keys:', err);
      let errorMessage = err.message || 'An unknown error occurred.';
      if (err.code === 'unauthenticated') {
        errorMessage = 'You must be logged in to perform this action.';
      }
      setError(errorMessage);
      toast({
        variant: 'destructive',
        title: 'Generation Failed',
        description: 'Could not generate new VAPID keys from the server. Check function logs for details.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = (textToCopy: string, type: string) => {
    navigator.clipboard.writeText(textToCopy);
    toast({
      title: 'Copied to Clipboard!',
      description: `${type} has been copied.`,
    });
  };

  const cliCommand = keys ? `npx firebase functions:config:set webpush_public_key="${keys.publicKey}" webpush_private_key="${keys.privateKey}"` : '';
  const envContent = keys ? `NEXT_PUBLIC_VAPID_PUBLIC_KEY="${keys.publicKey}"` : '';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Push Notification VAPID Keys</CardTitle>
        <CardDescription>
          Generate a unique set of security keys for sending push notifications. This is a one-time setup.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex justify-center">
            <Button onClick={handleGenerateKeys} disabled={isLoading}>
                {isLoading ? <Spinner /> : <><KeyRound className="mr-2" /> Generate VAPID Keys</>}
            </Button>
        </div>

        {error && (
            <Alert variant="destructive">
                <Terminal className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
            </Alert>
        )}

        {keys && (
            <div className="space-y-6 animate-in fade-in-50">
                <Alert>
                    <Terminal className="h-4 w-4" />
                    <AlertTitle>Action Required: One-Time Setup</AlertTitle>
                    <AlertDescription>
                    You must complete both steps below for notifications to work. For more details, see the `PUSH_NOTIFICATIONS_GUIDE.md` file.
                    </AlertDescription>
                </Alert>
                
                <div className="space-y-4 p-4 border rounded-lg">
                    <h3 className="font-semibold text-lg">Step 1: Set Server Keys</h3>
                    <p className="text-sm text-muted-foreground">
                        Run this command in your terminal. This securely saves your keys on the Firebase server so your backend function can use them. The keys must be <code className="bg-muted px-1 py-0.5 rounded">lowercase_and_with_underscores</code>.
                    </p>
                    <div className="flex gap-2">
                        <Input id="cli-command" readOnly value={cliCommand} className="font-mono text-xs" />
                        <Button variant="outline" size="icon" onClick={() => handleCopy(cliCommand, 'CLI Command')}>
                        <Copy className="h-4 w-4" />
                        </Button>
                    </div>
                </div>

                <div className="space-y-4 p-4 border rounded-lg">
                    <h3 className="font-semibold text-lg">Step 2: Configure Client App</h3>
                        <p className="text-sm text-muted-foreground">
                        Create a file named <code className="bg-muted px-1 py-0.5 rounded">.env.local</code> in your project's root folder and add this line to it. Then, restart your dev server.
                    </p>
                    <div className="flex gap-2">
                        <Input id="env-var" readOnly value={envContent} className="font-mono text-xs"/>
                        <Button variant="outline" size="icon" onClick={() => handleCopy(envContent, 'Environment Variable')}>
                            <Copy className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            </div>
        )}
      </CardContent>
    </Card>
  );
}
