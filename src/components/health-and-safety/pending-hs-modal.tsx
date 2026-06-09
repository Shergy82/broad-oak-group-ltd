'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useUserProfile } from '@/hooks/use-user-profile';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { writeBatch, doc, serverTimestamp, collection } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Spinner } from '@/components/shared/spinner';
import { ShieldCheck, FileText, Download, CheckCircle2 } from 'lucide-react';
import { downloadFile } from '@/file-proxy';

export function PendingHSModal() {
  const { user, pendingHSFiles, hasPendingHSFiles, hasPendingAnnouncements } = useAuth();
  const { userProfile } = useUserProfile();
  const [signature, setSignature] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Gating Logic: Announcements take priority. 
  // If announcements are pending, we hide the H&S modal so they don't stack confusingly.
  if (!user || !hasPendingHSFiles || hasPendingAnnouncements) return null;

  async function handleAcknowledgeAll() {
    if (!signature.trim() || !user || !userProfile) return;
    
    setIsSubmitting(true);
    try {
      if (!db) throw new Error("Database not ready");
      
      const batch = writeBatch(db);
      
      pendingHSFiles.forEach(file => {
        const ackRef = doc(collection(db, 'hsAcknowledgements'));
        batch.set(ackRef, {
          userId: user.uid,
          userName: userProfile.name,
          fileId: file.id,
          fileName: file.name,
          signature: signature.trim(),
          acknowledgedAt: serverTimestamp(),
        });
      });

      await batch.commit();
      window.location.reload(); // Refresh to clear state in AuthProvider
    } catch (e) {
      console.error("Failed to acknowledge H&S documents:", e);
    } finally {
      setIsSubmitting(false);
    }
  }

  const isSignatureValid = signature.trim().length >= 3;

  return (
    <Dialog open={true}>
      <DialogContent className="max-w-2xl" onInteractOutside={(e) => e.preventDefault()} showCloseButton={false}>
        <DialogHeader>
          <div className="flex items-center gap-2 mb-2">
            <ShieldCheck className="h-6 w-6 text-primary" />
            <DialogTitle>Health & Safety Sign-off Required</DialogTitle>
          </div>
          <DialogDescription>
            New Health & Safety documentation has been added. You must acknowledge that you have read and understood these files before continuing.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[40vh] my-4 rounded-md border bg-muted/20 p-4">
          <div className="space-y-3">
            {pendingHSFiles.map(file => (
              <div key={file.id} className="flex items-center justify-between p-3 rounded-lg bg-background border shadow-sm">
                <div className="flex items-center gap-3">
                  <FileText className="h-5 w-5 text-muted-foreground" />
                  <span className="text-sm font-medium truncate max-w-[300px]">{file.name}</span>
                </div>
                <Button variant="ghost" size="sm" onClick={() => downloadFile(file.fullPath)}>
                  <Download className="h-4 w-4 mr-1" />
                  Read
                </Button>
              </div>
            ))}
          </div>
        </ScrollArea>

        <div className="space-y-4 py-2">
            <div className="space-y-2">
                <Label htmlFor="signature">Digital Signature (Type your full name)</Label>
                <Input 
                    id="signature"
                    placeholder="Enter your name exactly as it appears on your profile"
                    value={signature}
                    onChange={(e) => setSignature(e.target.value)}
                    disabled={isSubmitting}
                    className="border-primary/50 focus:ring-primary"
                />
                <p className="text-xs text-muted-foreground">
                    By typing your name and clicking acknowledge, you confirm that you have read, understood, and agree to comply with the documentation listed above.
                </p>
            </div>
        </div>

        <DialogFooter>
          <Button 
            onClick={handleAcknowledgeAll} 
            disabled={isSubmitting || !isSignatureValid} 
            className="w-full h-12 text-lg font-bold"
          >
            {isSubmitting ? <Spinner /> : 
            <>
              <CheckCircle2 className="mr-2 h-5 w-5" />
              Acknowledge & Sign All
            </>
            }
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
