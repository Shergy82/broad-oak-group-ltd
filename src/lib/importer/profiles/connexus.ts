import ExcelJS from 'exceljs';
import { type PlannerProfile, type StandardShift, type ImportError, type UserMapEntry } from '../types';

export class ConnexusProfile implements PlannerProfile {
  id = 'connexus';
  name = 'Connexus Planner';
  description = 'Standard tabular format with explicit headers.';

  detect(workbook: ExcelJS.Workbook): boolean {
    const sheet = workbook.worksheets[0];
    if (!sheet) return false;
    
    // Look for Connexus specific headers
    const headerRow = sheet.getRow(1);
    let matches = 0;
    headerRow.eachCell(cell => {
      const txt = String(cell.value || '').toLowerCase();
      if (['property', 'job reference', 'appointment date'].some(h => txt.includes(h))) {
        matches++;
      }
    });
    return matches >= 2;
  }

  async parse(workbook: ExcelJS.Workbook, userMap: UserMapEntry[]): Promise<{ shifts: StandardShift[], errors: ImportError[] }> {
    const shifts: StandardShift[] = [];
    const errors: ImportError[] = [];
    // Basic implementation for MVP
    return { shifts, errors };
  }
}
