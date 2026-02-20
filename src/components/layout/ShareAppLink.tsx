'use client';

import { Button } from '@/components/ui/button';
import { useUserProfile } from '@/hooks/use-user-profile';
import { useToast } from '@/hooks/use-toast';
import { Share2 } from 'lucide-react';

export function ShareAppLink() {
  const { userProfile } = useUserProfile();
  const { toast } = useToast();

  if (!userProfile?.department) {
    return null;
  }

  const handleShare = () => {
    const department = encodeURIComponent(userProfile.department!);
    const shareUrl = `${window.location.origin}/signup?department=${department}`;
    navigator.clipboard.writeText(shareUrl);
    toast({
      title: 'Link Copied!',
      description: `A signup link for the ${userProfile.department} department has been copied to your clipboard.`,
    });
  };

  return (
    <Button variant="outline" size="sm" onClick={handleShare}>
      <Share2 className="mr-2 h-4 w-4" />
      Share App
    </Button>
  );
}
