'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { ShiftImporter } from './shift-importer';
import type { UserProfile } from '@/types';
import { UploadCloud } from 'lucide-react';

interface GlobalShiftImporterProps {
    userProfile: UserProfile;
}

export function GlobalShiftImporter({ userProfile }: GlobalShiftImporterProps) {
    const [open, setOpen] = useState(false);

    return (
        <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
                <Button variant="outline" size="sm">
                    <UploadCloud className="mr-2 h-4 w-4" />
                    Import Shifts
                </Button>
            </SheetTrigger>
            <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
                <div className="py-4 h-full">
                   <ShiftImporter userProfile={userProfile} />
                </div>
            </SheetContent>
        </Sheet>
    );
}
