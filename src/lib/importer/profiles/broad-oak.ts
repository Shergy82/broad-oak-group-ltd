import ExcelJS from 'exceljs';
import { type PlannerProfile, type StandardShift, type ImportError, type UserMapEntry } from '../types';

/**
 * Broad Oak Gas (Battleship) Profile - RESET
 * Ready for step-by-step logic implementation.
 */
export class BroadOakProfile implements PlannerProfile {
  id = 'broad-oak';
  name = 'Broad Oak Gas (Battleship)';
  description = 'Hierarchical grid: Property Section → Date Column → Work Cell.';

  detect(workbook: ExcelJS.Workbook): boolean {
    // Basic detection: look for a sheet that isn't hidden
    const sheet = workbook.worksheets.find(s => s.state !== 'hidden');
    return !!sheet;
  }

  async parse(workbook: ExcelJS.Workbook, userMap: UserMapEntry[]): Promise<{ shifts: StandardShift[], errors: ImportError[] }> {
    const shifts: StandardShift[] = [];
    const errors: ImportError[] = [];

    // Erased logic - ready for rebuild
    errors.push({
      message: 'Parser reset: No logic implemented yet.',
      severity: 'info',
      code: 'RESET_STATE'
    });

    return { shifts, errors };
  }
}
