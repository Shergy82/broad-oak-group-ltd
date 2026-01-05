import type { Shift, UserProfile, Project } from '@/types';
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
    task: '1st Fix Electrics',
    bNumber: 'B-123',
  },
  {
    id: 'mock-shift-2',
    userId: 'mock-user-1',
    date: createMockTimestamp(today),
    type: 'pm',
    status: 'confirmed',
    address: '123 Main St, Anytown',
    task: 'Fit kitchen sink',
    bNumber: 'B-123',
  },
  {
    id: 'mock-shift-8',
    userId: 'mock-user-1',
    date: createMockTimestamp(today),
    type: 'all-day',
    status: 'completed',
    address: '999 Victory Rd, Doneville',
    task: 'Final cleanup',
    bNumber: 'B-999',
  },


  // --- This Week's Shifts (Future) ---
  {
    id: 'mock-shift-3',
    userId: 'mock-user-1',
    date: createMockTimestamp(addDays(today, 2)), // e.g., Wednesday if today is Monday
    type: 'all-day',
    status: 'confirmed',
    address: '789 Pine Ln, Yourtown',
    task: 'Foundation work',
    bNumber: 'B-456',
  },
   {
    id: 'mock-shift-4',
    userId: 'mock-user-1',
    date: createMockTimestamp(addDays(today, 3)), // e.g., Thursday
    type: 'am',
    status: 'confirmed',
    address: '789 Pine Ln, Yourtown',
    task: 'Framing',
    bNumber: 'B-456',
  },

  // --- Next Week's Shifts ---
   {
    id: 'mock-shift-5',
    userId: 'mock-user-1',
    date: createMockTimestamp(addDays(today, 7)),
    type: 'all-day',
    status: 'pending-confirmation',
    address: '212 Birch Rd, Newplace',
    task: 'Roofing',
    bNumber: 'B-789',
  },
  {
    id: 'mock-shift-6',
    userId: 'mock-user-1',
    date: createMockTimestamp(addDays(today, 8)),
    type: 'pm',
    status: 'pending-confirmation',
    address: '212 Birch Rd, Newplace',
    task: 'Install windows',
    bNumber: 'B-789',
  },
  // --- Incomplete Shift Example ---
  {
    id: 'mock-shift-7',
    userId: 'mock-user-1',
    date: createMockTimestamp(subDays(today, 1)), // Yesterday
    type: 'all-day',
    status: 'incomplete',
    address: '404 Error Ave, Glitchtown',
    task: 'Fix the Flux Capacitor',
    notes: 'Could not find any plutonium, had to postpone.',
    bNumber: 'B-404',
  },
];

export const mockProjects: Project[] = [
  {
    id: 'proj-1',
    address: '123 Main St, Anytown',
    bNumber: 'B-123',
  },
  {
    id: 'proj-2',
    address: '789 Pine Ln, Yourtown',
    bNumber: 'B-456',
  },
  {
    id: 'proj-3',
    address: '212 Birch Rd, Newplace',
    bNumber: 'B-789',
  },
];
