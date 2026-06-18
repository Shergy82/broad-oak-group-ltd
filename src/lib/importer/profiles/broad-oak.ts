
import ExcelJS from 'exceljs';
import { type PlannerProfile, type StandardShift, type ImportError, type UserMapEntry } from '../types';

/**
 * Broad Oak Gas (Battleship) Profile
 * Logic: Identify Section Boundaries -> Extract Block Address -> Map Shifts
 */
export class BroadOakProfile implements PlannerProfile {
  id = 'broad-oak';
  name = 'Broad Oak Gas (Battleship)';
  description = 'Hierarchical extraction: Groups rows by SITE MANAGER dividers, finds address within block, then maps grid shifts from Column F.';

  private postcodeRegex = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;
  private eNumberRegex = /\bE\d{5,}\b/i;

  detect(workbook: ExcelJS.Workbook): boolean {
    // Look in all visible sheets
    return workbook.worksheets.some(sheet => {
      if (sheet.state === 'hidden') return false;
      let found = false;
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber > 50) return;
        const val = row.getCell(1).value?.toString().toUpperCase() || '';
        if (val.includes('SITE MANAGER') || val.includes('TECHNICAL MANAGER')) {
          found = true;
        }
      });
      return found;
    });
  }

  async parse(workbook: ExcelJS.Workbook, userMap: UserMapEntry[]): Promise<{ shifts: StandardShift[], errors: ImportError[] }> {
    const shifts: StandardShift[] = [];
    const errors: ImportError[] = [];
    
    const sheet = workbook.worksheets.find(s => {
        if (s.state === 'hidden') return false;
        let found = false;
        s.eachRow((row, rowNumber) => {
          if (rowNumber > 50) return;
          const val = row.getCell(1).value?.toString().toUpperCase() || '';
          if (val.includes('SITE MANAGER') || val.includes('TECHNICAL MANAGER')) found = true;
        });
        return found;
    });

    if (!sheet) {
        errors.push({ message: "No sheet with 'SITE MANAGER' markers found.", severity: 'error', code: 'NO_VALID_SHEET' });
        return { shifts, errors };
    }

    // 1. Identify all Divider Rows (Starts of Site Blocks)
    const dividerRows: number[] = [];
    sheet.eachRow((row, rowNumber) => {
      const colA = row.getCell(1).value?.toString().toUpperCase() || '';
      if (colA.includes('SITE MANAGER') || colA.includes('TECHNICAL MANAGER')) {
        dividerRows.push(rowNumber);
      }
    });

    if (dividerRows.length === 0) {
        errors.push({ message: "No 'SITE MANAGER' divider rows found.", severity: 'error', code: 'NO_DIVIDERS' });
        return { shifts, errors };
    }

    // 2. Process each Block (Two-Pass Strategy)
    for (let i = 0; i < dividerRows.length; i++) {
      const startRow = dividerRows[i];
      const nextDividerRow = dividerRows[i + 1];
      const endRow = nextDividerRow ? nextDividerRow - 1 : sheet.rowCount;

      // --- Pass 1: Scan block for Address, Dates, Manager, and Scheme ---
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

        // Capture Manager
        if (colA.toUpperCase().includes('SITE MANAGER')) {
          blockManager = colA.split(':')[1]?.trim() || colA.split('MANAGER')[1]?.trim() || blockManager;
        }

        // Capture Scheme
        if (colC.toUpperCase().includes('SCHEME') || colC.toUpperCase().includes('CONTRACT')) {
          blockScheme = colD.trim() || blockScheme;
        }

        // Capture Address & E-Ref from Column A Panel
        if (colA.trim()) {
           const eMatch = colA.match(this.eNumberRegex);
           if (eMatch) blockENumber = eMatch[0];
           
           if (this.postcodeRegex.test(colA)) {
               blockAddress = colA.trim();
           } else if (!blockAddress && !colA.toUpperCase().includes('SITE MANAGER')) {
               blockAddress = colA.trim();
           }
        }

        // Capture Dates (Horizontal)
        row.eachCell((cell, colNumber) => {
            if (colNumber >= 6) { // Grid starts at F
                const date = this.parseDate(cell.value);
                if (date) {
                    dateColumnMap.set(colNumber, date);
                }
            }
        });
      }

      // --- Pass 2: Extract work entries from the Grid ---
      for (let r = startRow; r <= endRow; r++) {
        const row = sheet.getRow(r);

        dateColumnMap.forEach((date, colNumber) => {
          const cell = row.getCell(colNumber);
          const cellValue = cell.value;
          if (!cellValue) return;

          const text = cellValue.toString().trim();
          if (text.length < 3) return;

          // SHIELD: Skip if cell is just a date repetition junk
          if (this.isHeaderJunk(cellValue)) return;

          const match = this.extractOperativeAndTask(text, userMap);
          if (match) {
            if (!blockAddress) {
                errors.push({
                    row: r,
                    cell: `${this.getColumnLetter(colNumber)}${r}`,
                    message: "Found work entry but could not identify the Site Address in this section.",
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
            // Flag unrecognized operatives that look like work entries
            if (text.includes('-') && text.length > 5) {
                errors.push({
                    row: r,
                    cell: `${this.getColumnLetter(colNumber)}${r}`,
                    message: `Found task but operative name was not recognized: "${text}"`,
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

  private extractOperativeAndTask(text: string, userMap: UserMapEntry[]) {
    const parts = text.split('-').map(p => p.trim());
    if (parts.length < 2) return null;

    const potentialName = parts[parts.length - 1].toUpperCase();
    const cleanPotentialName = potentialName.replace(/\b(AM|PM)\b/g, '').trim();

    for (const user of userMap) {
      const userName = user.originalName.toUpperCase();
      if (cleanPotentialName.includes(userName) || userName.includes(cleanPotentialName)) {
        let task = parts.slice(0, -1).join(' ').trim();
        
        let type: 'am' | 'pm' | 'all-day' = 'all-day';
        const taskUpper = task.toUpperCase();
        if (taskUpper.startsWith('AM ') || taskUpper.includes(' AM')) type = 'am';
        else if (taskUpper.startsWith('PM ') || taskUpper.includes(' PM')) type = 'pm';

        task = task.replace(/\b(AM|PM)\b/gi, '').replace(/^\s*[-:]\s*/, '').trim();

        return { user, task: task || "General Works", type };
      }
    }
    return null;
  }

  private isHeaderJunk(val: any): boolean {
    if (val instanceof Date) return true;
    const str = val.toString().toUpperCase();
    
    const months = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER', 'JAN', 'FEB', 'MAR', 'APR', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const days = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
    
    if (days.includes(str)) return true;
    if (months.includes(str)) return true;
    if (str.includes('2026') || str.includes('2025')) return true;
    
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
            return new Date(y, m, d);
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
