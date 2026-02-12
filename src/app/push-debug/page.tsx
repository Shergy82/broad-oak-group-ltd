'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Spinner } from '@/components/shared/spinner';

export default function DeprecatedPushDebugPage() {
    const router = useRouter();
    useEffect(() => {
        router.replace('/admin/notifications');
    }, [router]);

    return (
        <div className="flex h-screen w-full items-center justify-center">
            <Spinner size="lg" />
            <p className="ml-4">Redirecting to the new Notification Center...</p>
        </div>
    );
}
