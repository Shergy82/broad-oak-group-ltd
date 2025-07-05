import type { Timestamp } from 'firebase/firestore';

export type ShiftStatus = 'pending-confirmation' | 'confirmed' | 'completed' | 'incomplete';

export interface Shift {
  id: string;
  userId: string;
  date: Timestamp;
  type: 'am' | 'pm' | 'all-day';
  status: ShiftStatus;
  address: string;
  task: string;
  notes?: string;
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
  bNumber?: string;
}

export interface ProjectFile {
  id: string;
  name: string;
  url: string;
  fullPath: string; // Full path in Firebase Storage for deletion
  size?: number; // Optional size in bytes
  type?: string; // Optional MIME type
  uploadedAt: Timestamp;
}
