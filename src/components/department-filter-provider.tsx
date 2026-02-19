'use client';

import { createContext, useState, useEffect, useMemo } from 'react';
import { useUserProfile } from '@/hooks/use-user-profile';
import { useAllUsers } from '@/hooks/use-all-users';

const LS_DEPARTMENTS_KEY = 'owner_department_filter';

interface DepartmentFilterContextType {
    availableDepartments: string[];
    selectedDepartments: Set<string>;
    toggleDepartment: (department: string) => void;
    loading: boolean;
}

export const DepartmentFilterContext = createContext<DepartmentFilterContextType>({
    availableDepartments: [],
    selectedDepartments: new Set(),
    toggleDepartment: () => {},
    loading: true,
});

export function DepartmentFilterProvider({ children }: { children: React.ReactNode }) {
    const { userProfile, loading: profileLoading } = useUserProfile();
    const { users, loading: usersLoading } = useAllUsers();
    
    const [selectedDepartments, setSelectedDepartments] = useState<Set<string>>(new Set());

    const isOwner = userProfile?.role === 'owner';

    const availableDepartments = useMemo(() => {
        if (!isOwner || usersLoading) return [];
        const depts = new Set<string>();
        users.forEach(u => {
            if (u.department) depts.add(u.department);
        });
        return Array.from(depts).sort();
    }, [isOwner, users, usersLoading]);

    useEffect(() => {
        if (!isOwner || availableDepartments.length === 0) {
             if (!isOwner) setSelectedDepartments(new Set()); // Clear selection if not owner
             return;
        }

        try {
            const stored = localStorage.getItem(LS_DEPARTMENTS_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                // Ensure stored departments are still valid
                const validStored = new Set(parsed.filter((d: string) => availableDepartments.includes(d)));
                setSelectedDepartments(validStored);
            } else {
                // Default to all selected
                setSelectedDepartments(new Set(availableDepartments));
            }
        } catch (e) {
            console.error("Failed to load department filter from localStorage", e);
            setSelectedDepartments(new Set(availableDepartments));
        }
    }, [isOwner, availableDepartments]);

    const toggleDepartment = (department: string) => {
        if (!isOwner) return;
        const newSelected = new Set(selectedDepartments);
        if (newSelected.has(department)) {
            newSelected.delete(department);
        } else {
            newSelected.add(department);
        }
        setSelectedDepartments(newSelected);
        try {
            localStorage.setItem(LS_DEPARTMENTS_KEY, JSON.stringify(Array.from(newSelected)));
        } catch (e) {
            console.error("Failed to save department filter to localStorage", e);
        }
    };
    
    const value = {
        availableDepartments,
        selectedDepartments,
        toggleDepartment,
        loading: profileLoading || usersLoading,
    };

    return (
        <DepartmentFilterContext.Provider value={value}>
            {children}
        </DepartmentFilterContext.Provider>
    );
}
