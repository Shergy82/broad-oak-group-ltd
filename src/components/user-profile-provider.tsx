
'use client';

import { createContext, useState, useEffect } from 'react';
import { onSnapshot, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/use-auth';
import type { UserProfile } from '@/types';
import { usePathname, useRouter } from 'next/navigation';

interface UserProfileContextType {
    userProfile: UserProfile | null;
    loading: boolean;
}

export const UserProfileContext = createContext<UserProfileContextType>({
    userProfile: null,
    loading: true,
});

export function UserProfileProvider({ children }: { children: React.ReactNode }) {
    const { user, isLoading: isAuthLoading } = useAuth();
    const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
    const [isProfileLoading, setProfileLoading] = useState(true);
    const router = useRouter();
    const pathname = usePathname();

    useEffect(() => {
        if (isAuthLoading) {
            setProfileLoading(true);
            return;
        }
        
        if (!user) {
            setUserProfile(null);
            setProfileLoading(false);
            return;
        }
        
        if (!db) {
            setProfileLoading(false);
            return;
        }
        
        setProfileLoading(true);
        const unsubscribe = onSnapshot(doc(db, "users", user.uid), 
            (doc) => {
                if (doc.exists()) {
                    const profile = { uid: doc.id, ...doc.data() } as UserProfile;
                    setUserProfile(profile);

                    const isAuthPage = pathname.startsWith('/login') || pathname.startsWith('/signup') || pathname.startsWith('/forgot-password');

                    // Redirect pending users to a dedicated page
                    if (profile.status === 'pending-approval' && pathname !== '/pending-approval' && !isAuthPage) {
                        router.replace('/pending-approval');
                    }
                    // Redirect active users away from pending page
                    if (profile.status === 'active' && pathname === '/pending-approval') {
                        router.replace('/dashboard');
                    }

                } else {
                    setUserProfile(null);
                }
                setProfileLoading(false);
            }, 
            (error) => {
                console.error("Error fetching user profile:", error);
                setUserProfile(null);
                setProfileLoading(false);
            }
        );

        // Cleanup subscription on unmount
        return () => unsubscribe();

    }, [user, isAuthLoading, pathname, router]);

    const isLoading = isAuthLoading || isProfileLoading;

    return (
        <UserProfileContext.Provider value={{ userProfile, loading: isLoading }}>
            {children}
        </UserProfileContext.Provider>
    );
}
