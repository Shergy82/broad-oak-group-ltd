import ExcelJS from 'exceljs';
import { type PlannerProfile, type StandardShift, type ImportError, type UserMapEntry } from '../types';

/**
 * Standard Tabular Profile - RESET
 * Ready for step-by-step logic implementation.
 */
export class GenericProfile implements PlannerProfile {
  id = 'generic';
  name = 'Standard Tabular Planner';
  description = 'Traditional table where each row is a shift record.';

  detect(workbook: ExcelJS.Workbook): boolean {
    return false; // Disabled during reset
  }

  async parse(workbook: ExcelJS.Workbook, userMap: UserMapEntry[]): Promise<{ shifts: StandardShift[], errors: ImportError[] }> {
    return { shifts: [], errors: [] };
  }
}
