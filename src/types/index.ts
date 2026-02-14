import type { Timestamp } from 'firebase/firestore';

/* =========================
   Shifts
   ========================= */

export type ShiftStatus =
  | 'pending-confirmation'
  | 'confirmed'
  | 'on-site'
  | 'completed'
  | 'incomplete'
  | 'rejected';

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
  department?: string;
  notes?: string;
  createdAt: Timestamp;
  confirmedAt?: Timestamp;
}

/* =========================
   Users
   ========================= */

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
  department?: string;
}

/* =========================
   Projects
   ========================= */

export interface Project {
  id: string;
  address: string;
  eNumber?: string;
  council?: string;
  manager: string;
  department?: string;
  createdAt?: Timestamp;
  createdBy?: string;
  creatorId?: string;
  nextReviewDate?: Timestamp;
  contract?: string;
  deletionScheduledAt?: Timestamp;
  checklist?: EvidenceChecklistItem[];
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
  evidenceTag?: string;
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

/* =========================
   Announcements
   ========================= */

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

/* =========================
   Trades & Performance
   ========================= */

export interface Trade {
  id: string;
  name: string;
  tasks: TradeTask[];
}

export interface TradeTask {
  text: string;
  photoRequired: boolean;
  evidenceTag?: string;
  photoCount?: number;
}

export interface EvidenceChecklist {
    contractName: string;
    items: EvidenceChecklistItem[];
}
export interface EvidenceChecklistItem {
    id: string;
    text: string;
    photoCount?: number;
}


export interface PerformanceMetric {
  userId: string;
  userName: string;
  totalShifts: number;
  completedShifts: number;
  incompleteShifts: number;
  photosUploaded: number;
  completionRate: number;
  incompleteRate: number;
  failedToCloseShifts: number;
}

/* =========================
   Unavailability
   ========================= */

export interface Unavailability {
  id: string;
  userId: string;
  userName: string;
  startDate: Timestamp;
  endDate: Timestamp;
  reason: 'Holiday' | 'Sickness' | 'Other';
  createdAt: Timestamp;
}

/* =========================
   Push Notifications
   ========================= */

export interface PushSubscriptionPayload {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface VapidKeyResponse {
  publicKey: string;
}

export interface SetStatusRequest {
  enabled: boolean;
}

export interface GenericResponse {
  success: boolean;
  message?: string;
}
