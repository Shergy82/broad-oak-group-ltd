import ExcelJS from 'exceljs';

export interface UserMapEntry {
  uid: string;
  normalizedName: string;
  originalName: string;
  department?: string;
}

export interface StandardShift {
  date: Date;
  operative: string;
  operativeUid?: string;
  startTime?: string;
  endTime?: string;
  address: string;
  contract: string;
  task: string;
  room?: string;
  descriptionOfWorks: string;
  notes?: string;
  type: 'am' | 'pm' | 'all-day';
  eNumber?: string;
  department?: string;
  sourceCell: string;
  sourceSheet: string;
  sourcePlannerId: string;
  sourcePlannerName: string;
  plannerName: string;
  profileId: string;
  importKey: string;
  dateKey: string;
}

export interface ImportError {
  row?: number;
  cell?: string;
  sheet?: string;
  message: string;
  severity: 'error' | 'warning' | 'info' | 'debug';
  code: string;
  rawValues?: any;
  // Context for UI display
  operative?: string;
  date?: string;
  dateKey?: string; // Standard format for filtering
  address?: string;
  task?: string;
}

export interface PlannerProfile {
  id: string;
  name: string;
  description: string;
  detect(workbook: ExcelJS.Workbook): boolean;
  parse(workbook: ExcelJS.Workbook, userMap: UserMapEntry[]): Promise<{ shifts: StandardShift[], errors: ImportError[] }>;
}
