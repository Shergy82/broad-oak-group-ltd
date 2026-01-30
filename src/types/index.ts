import type { Timestamp } from 'firebase/firestore';

export type ShiftStatus = 'pending-confirmation' | 'confirmed' | 'on-site' | 'completed' | 'incomplete' | 'rejected';

export interface Shift {
  id: string;
  userId: string;
  userName?: string;
  date: Timestamp;
  type: 'am' | 'pm' | 'all-day';
  status: ShiftStatus;
  address: string;
  task: string;
  eNumber?: string;
  manager?: string;
  contract?: string;
  notes?: string;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
  updatedByUid?: string;
  updatedByAction?: string;
  confirmedAt?: Timestamp;
}

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  phoneNumber: string;
  role: 'user' | 'admin' | 'owner' | 'manager' | 'TLO';
  createdAt?: Timestamp;
  status?: 'active' | 'suspended' | 'pending-approval';
  employmentType?: 'direct' | 'subbie';
  operativeId?: string;
  trade?: string;
  notificationsEnabled?: boolean;
  notificationsUpdatedAt?: Timestamp;
}

export interface Unavailability {
  id: string;
  userId: string;
  userName: string;
  startDate: Timestamp;
  endDate: Timestamp;
  reason: 'Holiday' | 'Sickness' | 'Other';
  createdAt: Timestamp;
}

export interface Project {
  id: string;
  address: string;
  eNumber?: string;
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
  fullPath: string;
  size?: number;
  type?: string;
  uploadedAt: Timestamp;
  uploaderId: string;
  uploaderName: string;
}

export interface HealthAndSafetyFile {
  id: string;
  name: string;
  url: string;
  fullPath: string;
  size?: number;
  type?: string;
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
  id: string;
  userName: string;
  acknowledgedAt: Timestamp;
}

export interface TradeTask {
  text: string;
  photoRequired: boolean;
}

export interface Trade {
  id: string;
  name: string;
  tasks: TradeTask[];
}

export interface FunctionLog {
  id: string;
  functionName: string;
  message: string;
  level: 'log' | 'warn' | 'error' | 'info';
  timestamp: Timestamp;
  data?: { [key: string]: any };
}

// --- PUSH NOTIFICATION TYPES ---

export type PushSubscriptionPayload = {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
};

export interface VapidKeyResponse {
  publicKey: string;
}

export interface SetStatusRequest {
  status: 'subscribed' | 'unsubscribed';
  subscription?: PushSubscriptionPayload;
  endpoint?: string;
}

export interface GenericResponse {
  ok: boolean;
  message?: string;
}
