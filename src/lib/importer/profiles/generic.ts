import ExcelJS from 'exceljs';
import { type PlannerProfile, type StandardShift, type ImportError, type UserMapEntry } from '../types';

export class GenericProfile implements PlannerProfile {
  id = 'generic';
  name = 'Generic Template';
  description = 'Matches standard headers like Date, Name, Address, Task.';

  detect(workbook: ExcelJS.Workbook): boolean {
    return true; // Always matches as fallback
  }

  async parse(workbook: ExcelJS.Workbook, userMap: UserMapEntry[]): Promise<{ shifts: StandardShift[], errors: ImportError[] }> {
    const shifts: StandardShift[] = [];
    const errors: ImportError[] = [];
    // Basic fallback logic
    return { shifts, errors };
  }
}
