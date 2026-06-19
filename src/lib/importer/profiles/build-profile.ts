/**
 * BUILD PLANNER IMPORT PROFILE
 *
 * This profile is independent of the Gas planner logic.
 * Changes made here will not affect Gas planner reconciliation.
 */

import ExcelJS from 'exceljs';
import { type PlannerProfile, type StandardShift, type ImportError, type UserMapEntry } from '../types';
import { 
  normaliseText, 
  formatDateKey, 
  getTodayDateKey, 
  findSafeUserMatch, 
  getColumnLetter
} from '../core/utils';
import { format } from 'date-fns';

export class BuildProfile implements PlannerProfile {
  id = 'build-planner';
  name = 'Build Department Planner';
  description = 'Dedicated profile for Build department schedules.';

  detect(workbook: ExcelJS.Workbook): boolean {
    // Initial detection: look for common Build layout markers if they differ from Gas
    return workbook.worksheets.some(sheet => {
        const row1 = sheet.getRow(1).values?.toString().toUpperCase() || '';
        return row1.includes('BUILD') || row1.includes('CONTRACTOR');
    });
  }

  async parse(workbook: ExcelJS.Workbook, userMap: UserMapEntry[]): Promise<{ shifts: StandardShift[], errors: ImportError[] }> {
    const shifts: StandardShift[] = [];
    const errors: ImportError[] = [];
    const todayKey = getTodayDateKey();

    // Placeholder: Start with Gas-like logic but keep it isolated
    const sheet = workbook.worksheets.find(s => s.state !== 'hidden');
    if (!sheet) return { shifts, errors };

    // Build department specific parsing logic goes here...
    // (Currently using a safe baseline that respects the silent skip rule)

    return { shifts, errors };
  }
}
