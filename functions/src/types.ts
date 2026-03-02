import type { Timestamp } from 'firebase-admin/firestore';

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
  source?: 'manual' | 'import';
}
