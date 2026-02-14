'use client';
import dynamic from 'next/dynamic';
import { useMemo } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import type { Project } from '@/types';

interface DynamicMapProps {
    locations: Project[];
}

export const DynamicMap = (props: DynamicMapProps) => {
    const Map = useMemo(() => dynamic(() => import('@/components/shared/leaflet-map'), {
        loading: () => <Skeleton className="h-full w-full" />,
        ssr: false
    }), []);

    return <Map {...props} />;
};
