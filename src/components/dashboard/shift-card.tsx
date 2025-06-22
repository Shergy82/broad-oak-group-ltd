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
  'pending-confirmation': { label: 'Pending', variant: 'secondary' as const },
  confirmed: { label: 'Confirmed', variant: 'default' as const, className: 'bg-blue-600 hover:bg-blue-700' },
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
    <Card className="flex flex-col justify-between transition-all hover:shadow-lg">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">{format(shiftDate, 'eeee, MMM d')}</CardTitle>
          <Badge variant={statusInfo.variant} className={statusInfo.className}>
            {statusInfo.label}
          </Badge>
        </div>
        <div className="flex items-center text-muted-foreground pt-2">
          <ShiftIcon className="h-5 w-5 mr-2" />
          <span>{shiftTypeDetails[shift.type].label}</span>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Your shift for {format(shiftDate, 'MMMM do')} is {statusInfo.label.toLowerCase()}.
        </p>
      </CardContent>
      <CardFooter>
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
