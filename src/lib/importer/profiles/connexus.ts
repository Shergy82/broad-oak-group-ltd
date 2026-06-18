import ExcelJS from 'exceljs';
import { type PlannerProfile, type StandardShift, type ImportError, type UserMapEntry } from '../types';

/**
 * Connexus Profile - RESET
 */
export class ConnexusProfile implements PlannerProfile {
  id = 'connexus';
  name = 'Connexus Planner';
  description = 'Client-specific tabular layout.';

  detect(workbook: ExcelJS.Workbook): boolean {
    return false;
  }

  async parse(workbook: ExcelJS.Workbook, userMap: UserMapEntry[]): Promise<{ shifts: StandardShift[], errors: ImportError[] }> {
    return { shifts: [], errors: [] };
  }
}
