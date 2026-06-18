
import ExcelJS from 'exceljs';
import { type PlannerProfile, type StandardShift, type ImportError, type UserMapEntry } from '../types';

/**
 * Broad Oak Gas (Battleship) Profile
 * Logic: Identify Section Boundaries -> Extract Block Metadata -> Map Grid Shifts
 */
export class BroadOakProfile implements PlannerProfile {
  id = 'broad-oak';
  name = 'Broad Oak Gas (Battleship)';
  description = 'Hierarchical extraction: Groups rows by SITE MANAGER dividers, finds address within block, then maps grid shifts from Column F onwards.';

  private postcodeRegex = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;
  private eNumberRegex = /\b[BE]\d{5,}\b/i;

  detect(workbook: ExcelJS.Workbook): boolean {
    return workbook.worksheets.some(sheet => {
      if (sheet.state === 'hidden') return false;
      let found = false;
      // Check first 100 rows for the marker
      for (let i = 1; i <= 100; i++) {
        const row = sheet.getRow(i);
        // Check columns A, B, C for the marker
        for (let j = 1; j <= 3; j++) {
          const val = row.getCell(j).value?.toString().toUpperCase() || '';
          if (val.includes('SITE MANAGER') || val.includes('TECHNICAL MANAGER')) {
            found = true;
            break;
          }
        }
        if (found) break;
      }
      return found;
    });
  }

  async parse(workbook: ExcelJS.Workbook, userMap: UserMapEntry[]): Promise<{ shifts: StandardShift[], errors: ImportError[] }> {
    const shifts: StandardShift[] = [];
    const errors: ImportError[] = [];
    
    // Find the first visible sheet that looks like a Battleship planner
    const sheet = workbook.worksheets.find(s => this.detectSheet(s));

    if (!sheet) {
        errors.push({ message: "No valid planning sheet found. Look for 'SITE MANAGER' labels.", severity: 'error', code: 'NO_VALID_SHEET' });
        return { shifts, errors };
    }

    // 1. Identify all Divider Rows
    const dividerRows: number[] = [];
    sheet.eachRow((row, rowNumber) => {
      const colA = row.getCell(1).value?.toString().toUpperCase() || '';
      if (colA.includes('SITE MANAGER') || colA.includes('TECHNICAL MANAGER')) {
        dividerRows.push(rowNumber);
      }
    });

    if (dividerRows.length === 0) {
        errors.push({ message: "No property sections identified. Ensure 'SITE MANAGER' is in Column A.", severity: 'error', code: 'NO_DIVIDERS' });
        return { shifts, errors };
    }

    // 2. Process each Block
    for (let i = 0; i < dividerRows.length; i++) {
      const startRow = dividerRows[i];
      const nextDividerRow = dividerRows[i + 1];
      const endRow = nextDividerRow ? nextDividerRow - 1 : Math.max(sheet.rowCount, startRow + 20);

      // --- Pass 1: Scan block for Metadata ---
      let blockAddress = "";
      let blockENumber = "";
      let blockManager = "";
      let blockScheme = "";
      const dateColumnMap = new Map<number, Date>();

      for (let r = startRow; r <= endRow; r++) {
        const row = sheet.getRow(r);
        const colA = row.getCell(1).value?.toString() || '';
        const colC = row.getCell(3).value?.toString() || '';
        const colD = row.getCell(4).value?.toString() || '';

        // Manager
        if (colA.toUpperCase().includes('SITE MANAGER')) {
          blockManager = colA.split(':')[1]?.trim() || colA.split('MANAGER')[1]?.trim() || blockManager;
        }

        // Scheme
        if (colC.toUpperCase().includes('SCHEME') || colC.toUpperCase().includes('CONTRACT')) {
          blockScheme = colD.trim() || blockScheme;
        }

        // Address & E-Ref Logic
        if (colA.trim()) {
           const eMatch = colA.match(this.eNumberRegex);
           if (eMatch) blockENumber = eMatch[0];
           
           if (this.postcodeRegex.test(colA)) {
               blockAddress = colA.trim();
           } else if (!blockAddress && !colA.toUpperCase().includes('SITE MANAGER') && !colA.toUpperCase().includes('PHONE')) {
               blockAddress = colA.trim();
           }
        }

        // Dates
        row.eachCell((cell, colNumber) => {
            if (colNumber >= 6) { 
                const date = this.parseDate(cell.value);
                if (date) dateColumnMap.set(colNumber, date);
            }
        });
      }

      // --- Pass 2: Extract Shifts ---
      for (let r = startRow; r <= endRow; r++) {
        const row = sheet.getRow(r);

        dateColumnMap.forEach((date, colNumber) => {
          const cell = row.getCell(colNumber);
          const cellValue = cell.value;
          if (!cellValue) return;

          const text = cellValue.toString().trim();
          if (text.length < 3) return;

          // Pattern Shield
          if (this.isHeaderJunk(cellValue)) return;

          const match = this.extractOperativeAndTask(text, userMap);
          if (match) {
            if (!blockAddress) {
                errors.push({
                    row: r,
                    cell: `${this.getColumnLetter(colNumber)}${r}`,
                    message: "Work found but site address could not be identified in this panel.",
                    severity: 'error',
                    code: 'MISSING_ADDRESS',
                    rawValues: { text, date }
                });
                return;
            }

            shifts.push({
              date,
              address: blockAddress,
              eNumber: blockENumber,
              contract: blockScheme || "Gas Service",
              manager: blockManager,
              operative: match.user.originalName,
              operativeUid: match.user.uid,
              task: match.task,
              descriptionOfWorks: text,
              type: match.type,
              sourceCell: `${sheet.name}!${this.getColumnLetter(colNumber)}${r}`,
              sourceSheet: sheet.name
            });
          } else {
            // Check for potential work entries that failed matching
            if (text.match(/[-–—]/) && text.length > 5) {
                errors.push({
                    row: r,
                    cell: `${this.getColumnLetter(colNumber)}${r}`,
                    message: `Operative name not recognized in text: "${text}"`,
                    severity: 'warning',
                    code: 'USER_NOT_FOUND',
                    rawValues: { text, address: blockAddress, date }
                });
            }
          }
        });
      }
    }

    return { shifts, errors };
  }

  private detectSheet(sheet: ExcelJS.Worksheet): boolean {
    if (sheet.state === 'hidden') return false;
    let found = false;
    for (let i = 1; i <= 50; i++) {
        const val = sheet.getRow(i).getCell(1).value?.toString().toUpperCase() || '';
        if (val.includes('SITE MANAGER') || val.includes('TECHNICAL MANAGER')) {
            found = true;
            break;
        }
    }
    return found;
  }

  private extractOperativeAndTask(text: string, userMap: UserMapEntry[]) {
    // Support standard hyphen, en-dash, and em-dash
    const parts = text.split(/[-–—]/).map(p => p.trim());
    if (parts.length < 2) return null;

    const potentialName = parts[parts.length - 1].toUpperCase();
    const cleanPotentialName = potentialName.replace(/\b(AM|PM)\b/g, '').trim();

    for (const user of userMap) {
      const userName = user.originalName.toUpperCase();
      // Fuzzy matching: name is inside cell or cell part is inside name
      if (cleanPotentialName.includes(userName) || userName.includes(cleanPotentialName)) {
        let task = parts.slice(0, -1).join(' ').trim();
        
        let type: 'am' | 'pm' | 'all-day' = 'all-day';
        const taskUpper = task.toUpperCase();
        if (taskUpper.startsWith('AM ') || taskUpper.includes(' AM')) type = 'am';
        else if (taskUpper.startsWith('PM ') || taskUpper.includes(' PM')) type = 'pm';

        task = task.replace(/\b(AM|PM)\b/gi, '').replace(/^\s*[-:–—]\s*/, '').trim();

        return { user, task: task || "General Works", type };
      }
    }
    return null;
  }

  private isHeaderJunk(val: any): boolean {
    if (val instanceof Date) return true;
    const str = val.toString().toUpperCase();
    
    // Skip if it looks like a header label or just a year/day
    const junk = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER', 'JAN', 'FEB', 'MAR', 'APR', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
    
    if (junk.includes(str)) return true;
    if (str.length === 4 && !isNaN(parseInt(str))) return true; // Just a year
    
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
