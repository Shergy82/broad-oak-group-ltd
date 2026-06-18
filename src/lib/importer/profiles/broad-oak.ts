
import ExcelJS from 'exceljs';
import { type PlannerProfile, type StandardShift, type ImportError, type UserMapEntry } from '../types';

/**
 * Broad Oak Gas (Battleship) Profile - HIERARCHICAL REBUILD
 * Logic: Property Section (Col A) -> Date Column (Header Row) -> Work Cell (Grid)
 */
export class BroadOakProfile implements PlannerProfile {
  id = 'broad-oak';
  name = 'Broad Oak Gas (Battleship)';
  description = 'Hierarchical extraction: Properties in Col A, Dates in Col F+, Operatives embedded in grid cells.';

  private postcodeRegex = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;
  private eNumberRegex = /\bE\d{5,}\b/i;

  detect(workbook: ExcelJS.Workbook): boolean {
    const sheet = workbook.worksheets.find(s => s.state !== 'hidden');
    if (!sheet) return false;

    let dateCount = 0;
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber > 20) return;
      row.eachCell((cell, colIndex) => {
        if (colIndex >= 6 && this.parseDate(cell.value)) dateCount++;
      });
    });

    return dateCount >= 3;
  }

  async parse(workbook: ExcelJS.Workbook, userMap: UserMapEntry[]): Promise<{ shifts: StandardShift[], errors: ImportError[] }> {
    const shifts: StandardShift[] = [];
    const errors: ImportError[] = [];
    const sheet = workbook.worksheets.find(s => s.state !== 'hidden');
    if (!sheet) return { shifts: [], errors: [] };

    // 1. Find the Date Header Row (Row with highest density of dates in Col F+)
    let dateRowNumber = -1;
    let maxDates = 0;
    const dateColumnMap = new Map<number, Date>();

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber > 30) return;
      let rowDates = 0;
      row.eachCell((cell, colIndex) => {
        if (colIndex >= 6 && this.parseDate(cell.value)) rowDates++;
      });
      if (rowDates > maxDates) {
        maxDates = rowDates;
        dateRowNumber = rowNumber;
      }
    });

    if (dateRowNumber === -1) {
      errors.push({ message: "No horizontal date headers detected (Column F onwards).", severity: 'error', code: 'NO_DATES' });
      return { shifts: [], errors };
    }

    // Map columns to dates
    sheet.getRow(dateRowNumber).eachCell((cell, colNumber) => {
      if (colNumber >= 6) {
        const date = this.parseDate(cell.value);
        if (date) dateColumnMap.set(colNumber, date);
      }
    });

    // 2. Scan Rows and Maintain Property State
    let currentAddress = "";
    let currentENumber = "";
    let currentManager = "";
    let currentScheme = "";

    sheet.eachRow((row, rowNumber) => {
      // Skip headers
      if (rowNumber <= dateRowNumber) return;

      const colA = row.getCell(1).value?.toString() || '';
      const colC = row.getCell(3).value?.toString() || '';
      const colD = row.getCell(4).value?.toString() || '';

      // Check for Property Identifiers in Col A
      const hasPostcode = this.postcodeRegex.test(colA);
      const hasENumber = this.eNumberRegex.test(colA);

      if (hasPostcode || hasENumber) {
        currentAddress = colA.trim();
        const eMatch = colA.match(this.eNumberRegex);
        currentENumber = eMatch ? eMatch[0] : "";
      }

      // Check for Metadata (Manager/Scheme)
      if (colA.toUpperCase().includes('SITE MANAGER')) {
        currentManager = colD || "";
      }
      if (colC.toUpperCase().includes('SCHEME') || colC.toUpperCase().includes('CONTRACT')) {
        currentScheme = colD || "";
      }

      // 3. Scan Date Columns (F+) for Work Cells
      dateColumnMap.forEach((date, colNumber) => {
        const cell = row.getCell(colNumber);
        const cellValue = cell.value;
        if (!cellValue) return;

        const cellCoord = `${this.getColumnLetter(colNumber)}${rowNumber}`;

        // SHIELD: Skip if the cell is just a date object or string repeat of the header
        if (this.isDateOrHeaderRepeat(cellValue, date)) return;

        const text = cellValue.toString().trim();
        if (text.length < 3) return;

        // EXTRACTION: Split by hyphen and match operative
        const match = this.extractOperativeAndTask(text, userMap);

        if (match) {
          shifts.push({
            date,
            address: currentAddress || "Unknown Address",
            eNumber: currentENumber,
            contract: currentScheme || "General",
            manager: currentManager,
            operative: match.user.originalName,
            operativeUid: match.user.uid,
            task: match.task,
            descriptionOfWorks: text,
            type: match.type,
            sourceCell: `${sheet.name}!${cellCoord}`,
            sourceSheet: sheet.name
          });
        } else {
          // Flag as "Not Imported"
          errors.push({
            row: rowNumber,
            cell: cellCoord,
            message: `Operative not recognized in text: "${text.substring(0, 50)}..."`,
            severity: 'warning',
            code: 'USER_NOT_FOUND',
            rawValues: { text, address: currentAddress, date }
          });
        }
      });
    });

    return { shifts, errors };
  }

  private extractOperativeAndTask(text: string, userMap: UserMapEntry[]) {
    const parts = text.split('-').map(p => p.trim());
    const upperText = text.toUpperCase();

    // Check every user against the text
    for (const user of userMap) {
      const name = user.originalName.toUpperCase();
      if (upperText.includes(name)) {
        let task = text;
        // Clean the task by removing the name and separators
        task = task.replace(new RegExp(user.originalName, 'gi'), '')
                   .replace(/^[Aa][Mm]\s+/, '')
                   .replace(/^[Pp][Mm]\s+/, '')
                   .replace(/^\s*[-:]\s*/, '')
                   .replace(/\s*[-:]\s*$/, '')
                   .trim();

        let type: 'am' | 'pm' | 'all-day' = 'all-day';
        if (upperText.startsWith('AM ')) type = 'am';
        else if (upperText.startsWith('PM ')) type = 'pm';

        return { user, task: task || "General Works", type };
      }
    }
    return null;
  }

  private isDateOrHeaderRepeat(val: any, columnDate: Date): boolean {
    if (val instanceof Date) return true;
    if (typeof val === 'number') return true; // Likely a serial date
    
    const str = val.toString().toUpperCase();
    // Common date header strings to ignore
    if (str.includes('2026') || str.includes('2025')) return true;
    if (str.includes('JUN') || str.includes('JUL') || str.includes('AUG')) return true;
    
    return false;
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
