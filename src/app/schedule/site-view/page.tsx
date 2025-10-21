
'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

// This page has been moved to /site-schedule and is now accessible to all users.
// This component just redirects to the new location.
export default function SiteSchedulePageRedirect() {
    const router = useRouter();
    useEffect(() => {
        router.replace('/site-schedule');
    }, [router]);

    return null;
}
