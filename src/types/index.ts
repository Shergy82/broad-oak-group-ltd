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

export interface Project {
  id: string; // Firestore document ID
  address: string;
  bNumber: string;
}

export interface ProjectFile {
  id: string;
  name: string;
  url: string;
  path: string; // Full path in Firebase Storage for deletion
  size: number;
  type: string;
  uploadedAt: Timestamp;
}
