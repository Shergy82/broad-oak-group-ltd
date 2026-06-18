
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
    return workbook.worksheets.some(sheet => this.detectSheet(sheet));
  }

  async parse(workbook: ExcelJS.Workbook, userMap: UserMapEntry[]): Promise<{ shifts: StandardShift[], errors: ImportError[] }> {
    const shifts: StandardShift[] = [];
    const errors: ImportError[] = [];
    
    // Find the first visible sheet that looks like a Battleship planner
    const sheet = workbook.worksheets.find(s => this.detectSheet(s));

    if (!sheet) {
        errors.push({ 
          message: "Parser could not find a worksheet with 'SITE MANAGER' labels in columns A-C.", 
          severity: 'error', 
          code: 'NO_VALID_SHEET' 
        });
        // Log skipped sheets for technical debugging
        workbook.worksheets.forEach(s => {
          if (s.state !== 'hidden') {
            errors.push({ message: `Skipped sheet: "${s.name}" - No marker found.`, severity: 'debug', code: 'SHEET_SKIPPED' });
          }
        });
        return { shifts, errors };
    }

    errors.push({ message: `Processing active sheet: "${sheet.name}"`, severity: 'info', code: 'SHEET_START' });

    // 1. Identify all Divider Rows
    const dividerRows: number[] = [];
    sheet.eachRow((row, rowNumber) => {
      const colA = row.getCell(1).value?.toString().toUpperCase() || '';
      const colB = row.getCell(2).value?.toString().toUpperCase() || '';
      if (colA.includes('SITE MANAGER') || colB.includes('SITE MANAGER') || colA.includes('TECHNICAL MANAGER')) {
        dividerRows.push(rowNumber);
      }
    });

    if (dividerRows.length === 0) {
        errors.push({ message: "No property sections identified. Scanner looked for 'SITE MANAGER' in Column A/B.", severity: 'error', code: 'NO_DIVIDERS' });
        return { shifts, errors };
    }

    errors.push({ message: `Found ${dividerRows.length} property sections.`, severity: 'info', code: 'SECTIONS_FOUND' });

    // 2. Process each Block
    for (let i = 0; i < dividerRows.length; i++) {
      const startRow = dividerRows[i];
      const nextDividerRow = dividerRows[i + 1];
      const endRow = nextDividerRow ? nextDividerRow - 1 : Math.min(sheet.rowCount, startRow + 50);

      // --- Pass 1: Scan block for Metadata ---
      let blockAddress = "";
      let blockENumber = "";
      let blockManager = "";
      let blockScheme = "";
      const dateColumnMap = new Map<number, Date>();

      for (let r = startRow; r <= endRow; r++) {
        const row = sheet.getRow(r);
        const colA = row.getCell(1).value?.toString() || '';
        const colB = row.getCell(2).value?.toString() || '';
        const colC = row.getCell(3).value?.toString() || '';
        const colD = row.getCell(4).value?.toString() || '';

        // Manager
        if (colA.toUpperCase().includes('SITE MANAGER') || colB.toUpperCase().includes('SITE MANAGER')) {
          const val = colA || colB;
          blockManager = val.split(':')[1]?.trim() || val.split('MANAGER')[1]?.trim() || blockManager;
        }

        // Scheme
        if (colC.toUpperCase().includes('SCHEME') || colC.toUpperCase().includes('CONTRACT')) {
          blockScheme = colD.trim() || blockScheme;
        }

        // Address & E-Ref Logic (Check A and B)
        [colA, colB].forEach(val => {
            if (!val || val.trim().length < 3) return;
            const eMatch = val.match(this.eNumberRegex);
            if (eMatch) blockENumber = eMatch[0];
            
            if (this.postcodeRegex.test(val)) {
                blockAddress = val.trim();
            } else if (!blockAddress && !val.toUpperCase().includes('SITE MANAGER') && !val.toUpperCase().includes('PHONE')) {
                blockAddress = val.trim();
            }
        });

        // Dates - Scan every row in block for potential date headers (Columns F+)
        row.eachCell((cell, colNumber) => {
            if (colNumber >= 6) { 
                const date = this.parseDate(cell.value);
                if (date) dateColumnMap.set(colNumber, date);
            }
        });
      }

      if (dateColumnMap.size === 0) {
          errors.push({ message: `Section starting at row ${startRow} has no detectable dates in columns F+.`, severity: 'debug', code: 'NO_DATES_IN_SECTION', row: startRow });
          continue;
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

          // Pattern Shield: Ignore cells that just contain headers or the date itself
          if (this.isHeaderJunk(cellValue, date)) return;

          const match = this.extractOperativeAndTask(text, userMap);
          if (match) {
            if (!blockAddress) {
                errors.push({
                    row: r,
                    cell: `${this.getColumnLetter(colNumber)}${r}`,
                    message: `Work entry "${text}" found but no address was identified in this section.`,
                    severity: 'warning',
                    code: 'MISSING_ADDRESS',
                    rawValues: { text, date }
                });
                return;
            }

            shifts.push({
              date,
              address: blockAddress,
              eNumber: blockENumber,
              contract: blockScheme || "Gas Works",
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
            // Only flag as error if it looks like a real task (contains hyphen or long text)
            if (text.includes('-') || text.includes('–') || text.includes('—') || text.length > 10) {
                errors.push({
                    row: r,
                    cell: `${this.getColumnLetter(colNumber)}${r}`,
                    message: `Operative name not found in cell: "${text}"`,
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
    // Check first 50 rows, columns A-C for "SITE MANAGER"
    for (let i = 1; i <= 50; i++) {
        const row = sheet.getRow(i);
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
  }

  private extractOperativeAndTask(text: string, userMap: UserMapEntry[]) {
    // 1. Split by various hyphen types
    const parts = text.split(/[-–—]/).map(p => p.trim());
    
    // 2. Multi-Strategy matching
    for (const user of userMap) {
      const userName = user.originalName.toUpperCase();
      const normUser = user.normalizedName;

      // Strategy A: Check parts (Standard Task - NAME)
      if (parts.length >= 2) {
          const lastPart = parts[parts.length - 1].toUpperCase();
          if (lastPart.includes(userName) || userName.includes(lastPart)) {
              return this.finalizeMatch(parts.slice(0, -1).join(' - '), user);
          }
      }

      // Strategy B: Full text search (NAME - Task or Task NAME)
      const textUpper = text.toUpperCase();
      if (textUpper.includes(userName)) {
          let task = text.replace(new RegExp(user.originalName, 'gi'), '').replace(/[-–—]/g, '').trim();
          return this.finalizeMatch(task, user);
      }
    }
    
    return null;
  }

  private finalizeMatch(rawTask: string, user: UserMapEntry) {
    let task = rawTask || "General Works";
    let type: 'am' | 'pm' | 'all-day' = 'all-day';
    
    const taskUpper = task.toUpperCase();
    if (taskUpper.includes('AM')) type = 'am';
    else if (taskUpper.includes('PM')) type = 'pm';

    // Clean AM/PM markers from task
    task = task.replace(/\b(AM|PM)\b/gi, '').replace(/^\s*[-:–—]\s*/, '').trim();

    return { user, task: task || "General Works", type };
  }

  private isHeaderJunk(val: any, columnDate: Date): boolean {
    if (!val) return true;
    const str = val.toString().toUpperCase();
    
    // If cell contains the date itself
    if (val instanceof Date) return true;
    
    // If string matches month names or day names
    const junk = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER', 'JAN', 'FEB', 'MAR', 'APR', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
    if (junk.includes(str)) return true;

    // Check if it's just the day number of the date
    if (str === columnDate.getDate().toString()) return true;
    
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
