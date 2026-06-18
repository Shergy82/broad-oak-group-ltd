import ExcelJS from 'exceljs';
import { type PlannerProfile, type StandardShift, type ImportError, type UserMapEntry } from '../types';

/**
 * Standard Tabular Profile
 * Column A: Date | Column B: Operative | Column C: Address | etc.
 */
export class GenericProfile implements PlannerProfile {
  id = 'generic';
  name = 'Standard Tabular Planner';
  description = 'Traditional table where each row is a single shift record.';

  private headerKeywords = {
    date: ['DATE'],
    operative: ['OPERATIVE', 'STAFF', 'EMPLOYEE', 'NAME', 'WORKER'],
    address: ['ADDRESS', 'SITE', 'LOCATION', 'JOB'],
    task: ['TASK', 'WORKS', 'DESCRIPTION']
  };

  detect(workbook: ExcelJS.Workbook): boolean {
    const sheet = workbook.worksheets.find(s => s.state !== 'hidden');
    if (!sheet) return false;

    let headersFound = 0;
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber > 5) return;
      row.eachCell(cell => {
        const val = cell.value?.toString().toUpperCase() || '';
        if (this.headerKeywords.date.includes(val) || this.headerKeywords.operative.includes(val)) {
          headersFound++;
        }
      });
    });

    return headersFound >= 2;
  }

  async parse(workbook: ExcelJS.Workbook, userMap: UserMapEntry[]): Promise<{ shifts: StandardShift[], errors: ImportError[] }> {
    const shifts: StandardShift[] = [];
    const errors: ImportError[] = [];
    const sheet = workbook.worksheets.find(s => s.state !== 'hidden');
    if (!sheet) return { shifts: [], errors: [] };

    let headerRow = -1;
    const colMap: { [key: string]: number } = {};

    // 1. Find Headers
    sheet.eachRow((row, rowNumber) => {
      if (headerRow !== -1 || rowNumber > 10) return;
      row.eachCell((cell, colNumber) => {
        const val = cell.value?.toString().toUpperCase() || '';
        for (const [key, keywords] of Object.entries(this.headerKeywords)) {
          if (keywords.some(k => val.includes(k))) colMap[key] = colNumber;
        }
      });
      if (colMap.date && colMap.operative) headerRow = rowNumber;
    });

    if (headerRow === -1) return { shifts: [], errors: [] };

    // 2. Process Rows
    let lastValid: any = {};

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber <= headerRow) return;

      const rawDate = row.getCell(colMap.date).value;
      const date = this.parseDate(rawDate) || lastValid.date;
      
      const rawOp = row.getCell(colMap.operative).value?.toString().trim();
      const opName = rawOp || lastValid.operative;

      const addr = row.getCell(colMap.address).value?.toString().trim() || lastValid.address || '';
      const task = row.getCell(colMap.task).value?.toString().trim() || 'General Works';

      if (!date || !opName) return;

      lastValid = { date, operative: opName, address: addr };

      const user = this.matchUser(opName, userMap);
      if (user) {
        shifts.push({
          date,
          operative: user.originalName,
          operativeUid: user.uid,
          address: addr,
          contract: 'General',
          task,
          descriptionOfWorks: task,
          type: 'all-day',
          sourceCell: `${sheet.name}!A${rowNumber}`,
          sourceSheet: sheet.name
        });
      }
    });

    return { shifts, errors };
  }

  private matchUser(name: string, userMap: UserMapEntry[]): UserMapEntry | null {
    const normalized = name.toLowerCase().replace(/[^a-z]/g, '');
    return userMap.find(u => u.normalizedName === normalized) || null;
  }

  private parseDate(val: any): Date | null {
    if (val instanceof Date) return val;
    if (typeof val === 'number') return new Date(Math.round((val - 25569) * 864e5));
    return null;
  }
}

