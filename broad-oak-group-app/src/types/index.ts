import type { Timestamp } from 'firebase/firestore';

export type ShiftStatus = 'pending-confirmation' | 'confirmed' | 'on-site' | 'completed' | 'incomplete' | 'rejected';

export interface Shift {
  id: string;
  userId: string;
  userName?: string; // Add the user's name directly to the shift
  date: Timestamp;
  type: 'am' | 'pm' | 'all-day';
  status: ShiftStatus;
  address: string;
  task: string;
  bNumber?: string;
  manager?: string;
  notes?: string;
  createdAt: Timestamp;
  confirmedAt?: Timestamp;
}

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  phoneNumber: string;
  role: 'user' | 'admin' | 'owner';
  createdAt?: Timestamp;
  status?: 'active' | 'suspended' | 'pending-approval';
  employmentType?: 'direct' | 'subbie';
  operativeId?: string;
}

export interface Project {
  id: string; // Firestore document ID
  address: string;
  bNumber?: string;
  council?: string;
  manager: string;
  createdAt?: Timestamp;
  createdBy?: string;
  creatorId?: string;
  nextReviewDate?: Timestamp;
}

export interface ProjectFile {
  id: string;
  name: string;
  url: string;
  fullPath: string; // Full path in Firebase Storage for deletion
  size?: number; // Optional size in bytes
  type?: string; // Optional MIME type
  uploadedAt: Timestamp;
  uploaderId: string;
  uploaderName: string;
}

export interface HealthAndSafetyFile {
  id: string;
  name: string;
  url: string;
  fullPath: string; // Full path in Firebase Storage for deletion
  size?: number; // Optional size in bytes
  type?: string; // Optional MIME type
  uploadedAt: Timestamp;
  uploaderId: string;
  uploaderName: string;
}

export interface Announcement {
  id: string;
  title: string;
  content: string;
  authorName: string;
  authorId: string;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

export interface Acknowledgement {
    id: string; // This will be the user's UID
    userName: string;
    acknowledgedAt: Timestamp;
}
