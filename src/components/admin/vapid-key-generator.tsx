
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Copy, KeyRound, Terminal } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Spinner } from '@/components/shared/spinner';

export function VapidKeyGenerator() {
  const [keys, setKeys] = useState<{ publicKey: string; privateKey: string } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleGenerateKeys = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/generate-vapid-keys');
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch keys from server');
      }
      const vapidKeys = await response.json();
      setKeys(vapidKeys);
    } catch (error: any) {
      console.error('Failed to generate VAPID keys:', error);
      toast({
        variant: 'destructive',
        title: 'Key Generation Failed',
        description: error.message || 'Could not generate VAPID keys. Check the server logs.',
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

  const cliCommand = keys ? `npx firebase functions:config:set webpush.public_key="${keys.publicKey}" webpush.private_key="${keys.privateKey}"` : '';
  const envContent = keys ? `NEXT_PUBLIC_VAPID_PUBLIC_KEY="${keys.publicKey}"` : '';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Push Notification VAPID Keys</CardTitle>
        <CardDescription>
          Generate the security keys required for sending push notifications. This is a one-time setup.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {!keys && (
          <Button onClick={handleGenerateKeys} disabled={isLoading}>
            {isLoading ? <Spinner /> : <><KeyRound className="mr-2 h-4 w-4" /> Generate Keys</>}
          </Button>
        )}

        {keys && (
          <div className="space-y-6">
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
                    Run this command in your terminal. This securely saves your keys on the Firebase server so your backend function can use them.
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
