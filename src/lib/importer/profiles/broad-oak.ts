
import ExcelJS from 'exceljs';
import { type PlannerProfile, type StandardShift, type ImportError, type UserMapEntry } from '../types';

/**
 * Broad Oak Gas (Battleship) Profile
 * Hierarchical extraction: Property Panel (A) -> Date Column (F+) -> Work Cell
 */
export class BroadOakProfile implements PlannerProfile {
  id = 'broad-oak';
  name = 'Broad Oak Gas (Battleship)';
  description = 'Hierarchical property blocks with horizontal dates.';

  detect(workbook: ExcelJS.Workbook): boolean {
    const sheet = workbook.worksheets.find(s => s.state !== 'hidden');
    if (!sheet) return false;

    let markerFound = false;
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber > 20) return;
      const colA = row.getCell(1).value?.toString().toUpperCase() || '';
      if (colA.includes('SITE MANAGER') || colA.includes('TECHNICAL MANAGER')) {
        markerFound = true;
      }
    });
    return markerFound;
  }

  async parse(workbook: ExcelJS.Workbook, userMap: UserMapEntry[]): Promise<{ shifts: StandardShift[], errors: ImportError[] }> {
    const shifts: StandardShift[] = [];
    const errors: ImportError[] = [];
    const sheet = workbook.worksheets.find(s => s.state !== 'hidden');
    if (!sheet) return { shifts: [], errors: [] };

    let currentAddress = "";
    let currentENumber = "";
    let currentScheme = "";
    let currentManager = "";
    let dateColumnMap = new Map<number, Date>();

    sheet.eachRow((row, rowNumber) => {
      const colA = row.getCell(1).value?.toString() || '';
      const colC = row.getCell(3).value?.toString() || '';
      const colD = row.getCell(4).value?.toString() || '';

      // 1. Detect New Block / Marker Row
      if (colA.toUpperCase().includes('SITE MANAGER') || colA.toUpperCase().includes('TECHNICAL MANAGER')) {
        // Reset block context
        currentAddress = "";
        currentENumber = "";
        currentScheme = "";
        currentManager = colD || ""; // Manager usually in Col D
        
        // Scan for dates in THIS row starting at Col F
        dateColumnMap = new Map<number, Date>();
        for (let i = 6; i <= 30; i++) {
          const date = this.parseDate(row.getCell(i).value);
          if (date) dateColumnMap.set(i, date);
        }
        return;
      }

      // 2. Extract Property Metadata (Yellow Panel)
      // Look for Scheme
      if (colC.toUpperCase().includes('SCHEME')) {
        currentScheme = colD || "";
      }

      // Look for Property Anchor (Postcode or E-Number)
      const postcodeRegex = /[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}/i;
      const eNumberRegex = /\bE\d{5,}\b/i;
      
      if (postcodeRegex.test(colA)) {
        currentAddress = colA.trim();
        const eMatch = colA.match(eNumberRegex);
        if (eMatch) currentENumber = eMatch[0];
      }

      // 3. Scan Grid Cells (Col F+)
      if (dateColumnMap.size > 0 && currentAddress) {
        dateColumnMap.forEach((date, colIndex) => {
          const cellValue = row.getCell(colIndex).value?.toString().trim();
          if (!cellValue || !cellValue.includes('-')) return;

          const parsed = this.parseWorkCell(cellValue, userMap);
          if (parsed) {
            shifts.push({
              date,
              address: currentAddress,
              eNumber: currentENumber,
              contract: currentScheme || "General",
              manager: currentManager,
              operative: parsed.operativeName,
              operativeUid: parsed.user?.uid, // THIS IS THE DOCUMENT ID
              task: parsed.task,
              descriptionOfWorks: cellValue,
              type: parsed.type,
              sourceCell: `${sheet.name}!${this.getColumnLetter(colIndex)}${rowNumber}`,
              sourceSheet: sheet.name
            });
          } else {
            errors.push({
              row: rowNumber,
              cell: `${this.getColumnLetter(colIndex)}${rowNumber}`,
              message: `Operative not recognized: "${cellValue}"`,
              severity: 'warning',
              code: 'USER_NOT_FOUND',
              rawValues: { text: cellValue, address: currentAddress, date }
            });
          }
        });
      }
    });

    return { shifts, errors };
  }

  private parseWorkCell(text: string, userMap: UserMapEntry[]) {
    let cleanText = text.trim();
    let type: 'am' | 'pm' | 'all-day' = 'all-day';

    if (cleanText.toUpperCase().startsWith('AM ')) {
      type = 'am';
      cleanText = cleanText.substring(3).trim();
    } else if (cleanText.toUpperCase().startsWith('PM ')) {
      type = 'pm';
      cleanText = cleanText.substring(3).trim();
    }

    const parts = cleanText.split('-');
    const namePart = parts.pop()?.trim() || "";
    const taskPart = parts.join('-').trim() || "General Works";

    const user = this.matchUser(namePart, userMap);
    if (user) {
      return { user, operativeName: user.originalName, task: taskPart, type };
    }
    return null;
  }

  private matchUser(name: string, userMap: UserMapEntry[]): UserMapEntry | null {
    if (!name) return null;
    // Clean and normalize the name for fuzzy matching
    const cleanName = name.toLowerCase().replace(/[^a-z]/g, '');
    return userMap.find(u => u.normalizedName === cleanName) || null;
  }

  private parseDate(val: any): Date | null {
    if (val instanceof Date) return val;
    if (typeof val === 'number') return new Date(Math.round((val - 25569) * 864e5));
    if (typeof val === 'string') {
      const match = val.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
      if (match) {
        const d = parseInt(match[1], 10);
        const m = parseInt(match[2], 10) - 1;
        let y = parseInt(match[3], 10);
        if (y < 100) y += 2000;
        const date = new Date(y, m, d);
        return isNaN(date.getTime()) ? null : date;
      }
    }
    return null;
  }

  private getColumnLetter(colIndex: number): string {
    let temp, letter = '';
    while (colIndex > 0) {
      temp = (colIndex - 1) % 26;
      letter = String.fromCharCode(temp + 65) + letter;
      colIndex = (colIndex - temp - 1) / 26;
    }
    return letter;
  }
}
