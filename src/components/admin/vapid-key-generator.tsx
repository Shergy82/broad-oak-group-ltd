
'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Copy, Terminal } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

// A permanent, pre-generated set of VAPID keys for the application.
const VAPID_KEYS = {
  publicKey: 'BOMYtqfH99Sp5G_lAP_eA2Vn8RkM9JEpqD2y3fPz2aWb7cXOa-AY9zWb8tFWKHGKJq1yA7J3Ym-yKlpo2kL-Z_k',
  privateKey: 'iZ4WqipzLCTfWwBw0yMvW31s29j-gPRP9_HnSgJzJkY',
};

export function VapidKeyGenerator() {
  const { toast } = useToast();

  const handleCopy = (textToCopy: string, type: string) => {
    navigator.clipboard.writeText(textToCopy);
    toast({
      title: 'Copied to Clipboard!',
      description: `${type} has been copied.`,
    });
  };

  const cliCommand = `npx firebase functions:config:set webpush_public_key="${VAPID_KEYS.publicKey}" webpush_private_key="${VAPID_KEYS.privateKey}"`;
  const envContent = `NEXT_PUBLIC_VAPID_PUBLIC_KEY="${VAPID_KEYS.publicKey}"`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Push Notification VAPID Keys</CardTitle>
        <CardDescription>
          These security keys are required for sending push notifications. This is a one-time setup.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
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
      </CardContent>
    </Card>
  );
}
