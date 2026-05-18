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
    const [isAppLocked, setIsAppLocked] = useState(false);
    const [isProfileLoading, setProfileLoading] = useState(true);
    const [isSettingsLoading, setSettingsLoading] = useState(true);
    const router = useRouter();
    const pathname = usePathname();

    useEffect(() => {
        if (!db) {
            setSettingsLoading(false);
            return;
        }
        const settingsDocRef = doc(db, "settings", "app_status");
        const unsubscribe = onSnapshot(settingsDocRef, (docSnap) => {
            setIsAppLocked(docSnap.exists() && docSnap.data().isLocked === true);
            setSettingsLoading(false);
        }, (error) => {
            console.error("Error fetching app status:", error);
            setIsAppLocked(false); // Default to unlocked on error
            setSettingsLoading(false);
        });
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        if (isAuthLoading) {
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

    }, [user, isAuthLoading]);

    useEffect(() => {
        if (isAuthLoading || isProfileLoading || isSettingsLoading) {
            return;
        }
        
        if (user && userProfile) {
            const isPhil = userProfile.email === 'phil.s@broadoakgroup.com';
            const onLockedPage = pathname === '/app-locked';
            const isAuthPage = pathname.startsWith('/login') || pathname.startsWith('/signup') || pathname.startsWith('/forgot-password');

            if (isAppLocked && !isPhil && !onLockedPage) {
                router.replace('/app-locked');
                return;
            }

            if (!isAppLocked && onLockedPage) {
                router.replace('/dashboard');
                return;
            }
            
            if (userProfile.status === 'pending-approval' && pathname !== '/pending-approval' && !isAuthPage && !onLockedPage) {
                router.replace('/pending-approval');
            }
            if (userProfile.status === 'active' && pathname === '/pending-approval') {
                router.replace('/dashboard');
            }
        }
    }, [user, userProfile, isAppLocked, isAuthLoading, isProfileLoading, isSettingsLoading, pathname, router]);

    const isLoading = isAuthLoading || isProfileLoading || isSettingsLoading;

    return (
        <UserProfileContext.Provider value={{ userProfile, loading: isLoading }}>
            {children}
        </UserProfileContext.Provider>
    );
}
