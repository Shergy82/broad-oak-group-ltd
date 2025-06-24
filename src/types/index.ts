import type { Timestamp } from 'firebase/firestore';

export interface Shift {
  id: string;
  userId: string;
  date: Timestamp;
  type: 'am' | 'pm' | 'all-day';
  status: 'pending-confirmation' | 'confirmed' | 'completed';
  address: string;
  task: string;
}

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  phoneNumber: string;
  role: 'user' | 'admin' | 'owner';
  createdAt?: Timestamp;
}
