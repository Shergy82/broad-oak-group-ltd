
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { KeyRound, ClipboardCopy, Server, UploadCloud } from 'lucide-react';
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
  const deployCommand = 'npx firebase deploy --only functions';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Push Notification VAPID Keys</CardTitle>
        <CardDescription>
          Generate and configure the keys required for sending push notifications. You only need to do this once.
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
              <p className="text-sm text-muted-foreground">Follow these two steps to finish setup. If a copy button fails, manually select the text and press Ctrl+C (or Cmd+C).</p>
            </div>
            
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Server className="h-5 w-5"/>
                </div>
                <h4 className="font-semibold">Step 1: Configure the Server</h4>
              </div>
              <p className="text-xs text-muted-foreground pl-11">
                The Private Key is a secret. Run the following Firebase CLI command in your terminal to store both keys securely for your server-side functions.
              </p>
              <div className="flex w-full items-start gap-2 pl-11">
                <pre className="flex-1 font-mono text-xs bg-background p-3 rounded-md border overflow-x-auto whitespace-pre-wrap break-all">
                    <code>{firebaseConfigCommand}</code>
                </pre>
                <Button variant="outline" size="sm" onClick={() => copyToClipboard(firebaseConfigCommand, 'Firebase CLI command')} className="shrink-0">
                  <ClipboardCopy className="mr-2" />
                  Copy
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <UploadCloud className="h-5 w-5"/>
                </div>
                <h4 className="font-semibold">Step 2: Deploy Your Functions</h4>
              </div>
               <p className="text-xs text-muted-foreground pl-11">
                This command uploads your new functions (including the key provider) to the server. Run it in your terminal after completing Step 1.
              </p>
              <div className="flex w-full items-start gap-2 pl-11">
                <pre className="flex-1 font-mono text-xs bg-background p-3 rounded-md border overflow-x-auto whitespace-pre-wrap break-all">
                    <code>{deployCommand}</code>
                </pre>
                <Button variant="outline" size="sm" onClick={() => copyToClipboard(deployCommand, 'Deploy command')} className="shrink-0">
                  <ClipboardCopy className="mr-2" />
                  Copy
                </Button>
              </div>
            </div>
             <p className="text-xs text-center text-muted-foreground pt-4">
                After deploying, refresh the application. The notification bell in the header should become active.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
