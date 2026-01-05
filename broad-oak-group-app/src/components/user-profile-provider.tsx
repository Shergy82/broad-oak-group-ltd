'use client';

import { createContext, useState, useEffect } from 'react';
import { onSnapshot, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/use-auth';
import type { UserProfile } from '@/types';

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

    useEffect(() => {
        // Don't do anything until we have a user
        if (!user) {
            setUserProfile(null);
            setProfileLoading(false);
            return;
        }
        
        // If firebase is not configured, stop loading.
        if (!db) {
            setProfileLoading(false);
            return;
        }
        
        setProfileLoading(true);
        const unsubscribe = onSnapshot(doc(db, "users", user.uid), 
            (doc) => {
                if (doc.exists()) {
                    setUserProfile({ uid: doc.id, ...doc.data() } as UserProfile);
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

    }, [user]);

    const isLoading = isAuthLoading || isProfileLoading;

    return (
        <UserProfileContext.Provider value={{ userProfile, loading: isLoading }}>
            {children}
        </UserProfileContext.Provider>
    );
}
