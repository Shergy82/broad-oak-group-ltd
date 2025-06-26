
'use client';

import { useState } from 'react';
import * as webPush from 'web-push';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Copy, KeyRound, Terminal } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export function VapidKeyGenerator() {
  const [keys, setKeys] = useState<{ publicKey: string; privateKey: string } | null>(null);
  const { toast } = useToast();

  const handleGenerateKeys = () => {
    const vapidKeys = webPush.generateVAPIDKeys();
    setKeys(vapidKeys);
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
          <Button onClick={handleGenerateKeys}>
            <KeyRound className="mr-2" />
            Generate Keys
          </Button>
        )}

        {keys && (
          <div className="space-y-6">
            <Alert>
              <Terminal className="h-4 w-4" />
              <AlertTitle>Action Required!</AlertTitle>
              <AlertDescription>
                You must complete both steps below for notifications to work.
              </AlertDescription>
            </Alert>
            
            <div className="space-y-4 p-4 border rounded-lg">
                <h3 className="font-semibold text-lg">Step 1: Configure the Server</h3>
                <p className="text-sm text-muted-foreground">
                    Copy this command and run it in your terminal. This securely saves your keys on the Firebase server where your function can access them.
                </p>
                <div className="flex gap-2">
                    <Input id="cli-command" readOnly value={cliCommand} className="font-mono text-xs" />
                    <Button variant="outline" size="icon" onClick={() => handleCopy(cliCommand, 'CLI Command')}>
                    <Copy />
                    </Button>
                </div>
            </div>

            <div className="space-y-4 p-4 border rounded-lg">
                <h3 className="font-semibold text-lg">Step 2: Configure the Client App</h3>
                 <p className="text-sm text-muted-foreground">
                    Create a file named <code className="bg-muted px-1 py-0.5 rounded">.env.local</code> in the root of your project (if it doesn't exist) and add the following line to it. Then, restart your dev server.
                </p>
                <div className="flex gap-2">
                    <Input id="env-var" readOnly value={envContent} className="font-mono text-xs"/>
                    <Button variant="outline" size="icon" onClick={() => handleCopy(envContent, 'Environment Variable')}>
                        <Copy />
                    </Button>
                </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
