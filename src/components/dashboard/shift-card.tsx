'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { doc, updateDoc } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '@/lib/firebase';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Clock, Sunrise, Sunset, ThumbsUp, CheckCircle2 } from 'lucide-react';
import { Spinner } from '@/components/shared/spinner';
import type { Shift } from '@/types';
import { useAuth } from '@/hooks/use-auth';

interface ShiftCardProps {
  shift: Shift;
}

const shiftTypeDetails = {
  am: { icon: Sunrise, label: 'AM Shift', color: 'bg-sky-500' },
  pm: { icon: Sunset, label: 'PM Shift', color: 'bg-orange-500' },
  'all-day': { icon: Clock, label: 'All Day', color: 'bg-indigo-500' },
};

const statusDetails = {
  'pending-confirmation': { label: 'Pending', variant: 'secondary' as const, className: '' },
  confirmed: { label: 'Confirmed', variant: 'default' as const, className: 'bg-primary hover:bg-primary/90' },
  completed: { label: 'Completed', variant: 'default' as const, className: 'bg-green-600 hover:bg-green-700' },
};

export function ShiftCard({ shift }: ShiftCardProps) {
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);

  const shiftDate = shift.date.toDate();
  const ShiftIcon = shiftTypeDetails[shift.type].icon;
  const statusInfo = statusDetails[shift.status];

  const handleUpdateStatus = async (newStatus: 'confirmed' | 'completed') => {
    if (!isFirebaseConfigured || !db || !user) {
      toast({
        variant: 'destructive',
        title: 'Authentication Error',
        description: 'You must be logged in to update shifts.',
      });
      return;
    }

    setIsLoading(true);
    try {
      const shiftRef = doc(db, 'shifts', shift.id);
      await updateDoc(shiftRef, { status: newStatus });
      toast({
        title: `Shift ${newStatus}`,
        description: 'Your shift status has been updated.',
      });
      router.refresh(); // Re-fetches data on the server
    } catch (error: any) {
      let description = 'Could not update shift status.';
      if (error.code === 'permission-denied') {
        description = "You don't have permission to update this shift. Please check your Firestore security rules.";
      }
      toast({
        variant: 'destructive',
        title: 'Update Failed',
        description,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="flex flex-col overflow-hidden transition-all hover:shadow-xl border-border hover:border-primary/40">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 bg-card p-4">
        <div className="flex items-center gap-3">
          <div className={`flex items-center justify-center rounded-lg w-12 h-12 ${shiftTypeDetails[shift.type].color}`}>
            <ShiftIcon className="h-6 w-6 text-white" />
          </div>
          <div>
            <CardTitle className="text-md font-bold">{shiftTypeDetails[shift.type].label}</CardTitle>
            <p className="text-sm text-muted-foreground">{format(shiftDate, 'eeee, MMM d')}</p>
          </div>
        </div>
        <Badge variant={statusInfo.variant} className={`${statusInfo.className} shrink-0`}>
          {statusInfo.label}
        </Badge>
      </CardHeader>
      <CardContent className="p-4 text-left grow flex flex-col justify-center space-y-1 text-sm">
        <p className="font-semibold">{shift.address}</p>
        <p><span className="text-muted-foreground">Task:</span> {shift.dailyTask}</p>
        <p><span className="text-muted-foreground">B No:</span> {shift.bNumber}</p>
        {shift.siteManager && <p><span className="text-muted-foreground">Site Manager:</span> {shift.siteManager}</p>}
      </CardContent>
      <CardFooter className="p-2 bg-muted/30">
        {shift.status === 'pending-confirmation' && (
          <Button onClick={() => handleUpdateStatus('confirmed')} className="w-full bg-accent text-accent-foreground hover:bg-accent/90" disabled={isLoading}>
            {isLoading ? <Spinner /> : <><ThumbsUp className="mr-2 h-4 w-4" /> Accept Shift</>}
          </Button>
        )}
        {shift.status === 'confirmed' && (
          <Button onClick={() => handleUpdateStatus('completed')} className="w-full bg-green-500 text-white hover:bg-green-600" disabled={isLoading}>
            {isLoading ? <Spinner /> : <><CheckCircle2 className="mr-2 h-4 w-4" /> Mark as Complete</>}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
