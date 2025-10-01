
'use client';

import { useEffect, useState, useCallback } from 'react';
import { httpsCallable, functions } from '@/lib/firebase';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/shared/spinner';
import { CheckCircle, AlertCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { useToast } from '@/hooks/use-toast';
import { usePushNotifications } from '@/hooks/use-push-notifications';


export function VapidKeyGenerator() {
  const [status, setStatus] = useState<'loading' | 'configured' | 'unconfigured' | 'error'>('loading');
  const [cliCommand, setCliCommand] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const { toast } = useToast();
  const { isSupported } = usePushNotifications();

  const copyToClipboard = useCallback(() => {
    if (!cliCommand) return;
    navigator.clipboard.writeText(cliCommand);
    toast({ title: 'Copied to clipboard!' });
  }, [cliCommand, toast]);
  
  useEffect(() => {
    async function checkKeys() {
      if (!functions) {
        setStatus('error');
        return;
      }
      try {
        const getVapidPublicKey = httpsCallable(functions, 'getVapidPublicKey');
        const result = await getVapidPublicKey();
        const key = (result.data as { publicKey: string }).publicKey;

        if (key && key.length > 10) {
          setStatus('configured');
          setPublicKey(key);
        } else {
          setStatus('unconfigured');
        }
      } catch (e: any) {
        if (e.code === 'not-found' || (e.details && e.details.code === 'NOT_FOUND')) {
          setStatus('unconfigured');
        } else {
          console.error("Error checking VAPID key status:", e);
          setStatus('error');
        }
      }
    }
    if (isSupported) {
        checkKeys();
    } else {
        setStatus('loading');
    }
  }, [isSupported]);
  
  useEffect(() => {
    if (status === 'unconfigured') {
      const pk = `YOUR_PUBLIC_KEY`;
      const sk = `YOUR_PRIVATE_KEY`;
      setCliCommand(`firebase functions:params:set webpush_public_key='${pk}' webpush_private_key='${sk}'`);
    }
  }, [status]);


  if (!isSupported) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>VAPID Key Status</CardTitle>
        <CardDescription>
          Push notifications require VAPID keys to be configured as environment variables for the backend.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {status === 'loading' && <div className="flex items-center gap-2"><Spinner /> Checking configuration...</div>}
        
        {status === 'error' && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>Could not verify key status. Firebase Functions may not be available.</AlertDescription>
          </Alert>
        )}

        {status === 'configured' && (
          <Alert>
            <CheckCircle className="h-4 w-4" />
            <AlertTitle>Configuration Complete</AlertTitle>
            <AlertDescription>
                <p>The VAPID public key is configured and notifications are active.</p>
                <p className="text-xs text-muted-foreground mt-2 break-all"><strong>Key:</strong> {publicKey}</p>
            </AlertDescription>
          </Alert>
        )}

        {status === 'unconfigured' && (
          <div className="space-y-4">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Action Required: Configure VAPID Keys</AlertTitle>
              <AlertDescription>Follow the steps below to enable push notifications.</AlertDescription>
            </Alert>
            <div className="space-y-3 text-sm p-4 border rounded-lg">
                <p><strong>Step 1: Install web-push</strong> (if you haven't already)</p>
                <code className="block bg-muted p-2 rounded-md text-xs font-mono">npm install -g web-push</code>
                
                <p><strong>Step 2: Generate Keys</strong><br/>Run this command in your terminal. It will print a public and private key. Keep them safe.</p>
                <code className="block bg-muted p-2 rounded-md text-xs font-mono">web-push generate-vapid-keys</code>

                <p><strong>Step 3: Set Keys in Firebase</strong><br/>Copy the command below, replace the placeholder keys with the ones you just generated, and run it in your project's root directory.</p>
                <div className="relative">
                    <code className="block bg-muted p-3 pr-20 rounded-md text-xs font-mono overflow-x-auto whitespace-pre">
                        {cliCommand}
                    </code>
                     <Button variant="ghost" size="sm" onClick={copyToClipboard} className="absolute top-1/2 right-2 -translate-y-1/2 h-7">Copy</Button>
                </div>
                
                <p><strong>Step 4: Redeploy Functions</strong><br/>Run the deploy command to apply the new configuration.</p>
                <code className="block bg-muted p-2 rounded-md text-xs font-mono">firebase deploy --only functions</code>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
