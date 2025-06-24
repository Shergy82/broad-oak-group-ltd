import type { Shift, UserProfile } from '@/types';
import { Timestamp } from 'firebase/firestore';
import { startOfToday, addDays, subDays } from 'date-fns';

// Helper to create a mock Timestamp object that works with the existing components
const createMockTimestamp = (date: Date): Timestamp => {
    return new Timestamp(date.getTime() / 1000, 0);
};

const today = startOfToday();

export const mockUsers: UserProfile[] = [
  {
    uid: 'mock-user-1',
    name: 'John Doe',
    email: 'john.doe@example.com',
    phoneNumber: '123-456-7890',
    role: 'user',
    createdAt: createMockTimestamp(subDays(today, 10)),
  },
  {
    uid: 'mock-admin-1',
    name: 'Jane Smith (Admin)',
    email: 'jane.smith@example.com',
    phoneNumber: '098-765-4321',
    role: 'admin',
    createdAt: createMockTimestamp(subDays(today, 30)),
  },
  {
    uid: 'mock-owner-1',
    name: 'Phil S (Owner)',
    email: 'phil.s@broadoakgroup.com',
    phoneNumber: '555-555-5555',
    role: 'owner',
    createdAt: createMockTimestamp(subDays(today, 100)),
  },
    {
    uid: 'mock-user-2',
    name: 'Alice Johnson',
    email: 'alice.j@example.com',
    phoneNumber: '111-222-3333',
    role: 'user',
    createdAt: createMockTimestamp(subDays(today, 5)),
  },
];


export const mockShifts: Shift[] = [
  // --- Today's Shifts ---
  {
    id: 'mock-shift-1',
    userId: 'mock-user-1',
    date: createMockTimestamp(today),
    type: 'am',
    status: 'pending-confirmation',
    address: '123 Main St, Anytown',
    bNumber: 'B12345',
    dailyTask: 'Install new windows',
    siteManager: 'Bob Vance',
  },
  {
    id: 'mock-shift-2',
    userId: 'mock-user-1',
    date: createMockTimestamp(today),
    type: 'pm',
    status: 'confirmed',
    address: '456 Oak Ave, Somecity',
    bNumber: 'B67890',
    dailyTask: 'Repair roofing',
    siteManager: 'Bob Vance',
  },

  // --- This Week's Shifts (Future) ---
  {
    id: 'mock-shift-3',
    userId: 'mock-user-1',
    date: createMockTimestamp(addDays(today, 2)), // e.g., Wednesday if today is Monday
    type: 'all-day',
    status: 'confirmed',
    address: '789 Pine Ln, Yourtown',
    bNumber: 'B11223',
    dailyTask: 'Full kitchen remodel',
    siteManager: 'Rita Repulsa',
  },
   {
    id: 'mock-shift-4',
    userId: 'mock-user-1',
    date: createMockTimestamp(addDays(today, 3)), // e.g., Thursday
    type: 'am',
    status: 'confirmed',
    address: '101 Maple Dr, Anotherville',
    bNumber: 'B44556',
    dailyTask: 'Bathroom plumbing check',
    siteManager: 'Rita Repulsa',
  },

  // --- Next Week's Shifts ---
   {
    id: 'mock-shift-5',
    userId: 'mock-user-1',
    date: createMockTimestamp(addDays(today, 7)),
    type: 'all-day',
    status: 'pending-confirmation',
    address: '212 Birch Rd, Newplace',
    bNumber: 'B77889',
    dailyTask: 'Foundation inspection',
    siteManager: 'Lord Zedd',
  },
  {
    id: 'mock-shift-6',
    userId: 'mock-user-1',
    date: createMockTimestamp(addDays(today, 8)),
    type: 'pm',
    status: 'pending-confirmation',
    address: '333 Cedar Ct, Nextown',
    bNumber: 'B99001',
    dailyTask: 'Landscaping project kickoff',
    siteManager: 'Lord Zedd',
  },
];
