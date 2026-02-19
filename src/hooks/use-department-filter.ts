'use client';

import { useContext } from 'react';
import { DepartmentFilterContext } from '@/components/department-filter-provider';

export const useDepartmentFilter = () => {
  const context = useContext(DepartmentFilterContext);
  if (context === undefined) {
    throw new Error('useDepartmentFilter must be used within a DepartmentFilterProvider');
  }
  return context;
};
