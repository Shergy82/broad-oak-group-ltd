
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
    const sheet = workbook.worksheets.find(s => s.state !== 'hidden');
    if (!sheet) return false;

    let markerFound = false;
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber > 30) return;
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

    // 1. Identify all Divider Rows (Starts of Site Blocks)
    const dividerRows: number[] = [];
    sheet.eachRow((row, rowNumber) => {
      const colA = row.getCell(1).value?.toString().toUpperCase() || '';
      if (colA.includes('SITE MANAGER') || colA.includes('TECHNICAL MANAGER')) {
        dividerRows.push(rowNumber);
      }
    });

    if (dividerRows.length === 0) {
      errors.push({ message: "No 'SITE MANAGER' dividers found in Column A.", severity: 'error', code: 'NO_DIVIDERS' });
      return { shifts: [], errors };
    }

    // 2. Process each Block (from one divider to the next)
    for (let i = 0; i < dividerRows.length; i++) {
      const startRow = dividerRows[i];
      const endRow = dividerRows[i + 1] ? dividerRows[i + 1] - 1 : sheet.rowCount;

      // --- Block Pass 1: Identify Property Info ---
      let blockAddress = "";
      let blockENumber = "";
      let blockManager = "";
      let blockScheme = "";
      const dateColumnMap = new Map<number, Date>();

      // Collect all Column A text to find the best address candidate
      const colAStrings: string[] = [];

      for (let r = startRow; r <= endRow; r++) {
        const row = sheet.getRow(r);
        const colA = row.getCell(1).value?.toString() || '';
        const colC = row.getCell(3).value?.toString() || '';
        const colD = row.getCell(4).value?.toString() || '';

        if (colA.trim()) colAStrings.push(colA.trim());

        // Capture Manager from the divider row itself
        if (r === startRow && colA.toUpperCase().includes('SITE MANAGER')) {
          blockManager = colA.split(':')[1]?.trim() || colA.split('MANAGER')[1]?.trim() || "";
        }

        // Capture Scheme from Column C/D
        if (colC.toUpperCase().includes('SCHEME') || colC.toUpperCase().includes('CONTRACT')) {
          blockScheme = colD.trim() || "";
        }

        // Capture Dates (From the Header Row of this block)
        if (r === startRow) {
          row.eachCell((cell, colNumber) => {
            if (colNumber >= 6) {
              const date = this.parseDate(cell.value);
              if (date) dateColumnMap.set(colNumber, date);
            }
          });
        }
      }

      // Find best address from collected Column A strings
      const eMatchString = colAStrings.find(s => this.eNumberRegex.test(s));
      const postcodeString = colAStrings.find(s => this.postcodeRegex.test(s));
      
      blockAddress = postcodeString || eMatchString || colAStrings[colAStrings.length - 1] || "";
      if (eMatchString) {
        const match = eMatchString.match(this.eNumberRegex);
        if (match) blockENumber = match[0];
      }

      // --- Block Pass 2: Extract Grid Shifts ---
      for (let r = startRow; r <= endRow; r++) {
        const row = sheet.getRow(r);

        dateColumnMap.forEach((date, colNumber) => {
          const cell = row.getCell(colNumber);
          const cellValue = cell.value;
          if (!cellValue) return;

          const cellCoord = `${this.getColumnLetter(colNumber)}${r}`;

          // SHIELD: Skip if cell is just a date repetition or common header junk
          if (this.isHeaderJunk(cellValue, date)) return;

          const text = cellValue.toString().trim();
          if (text.length < 3) return;

          // EXTRACT: Match Operative Name from Text (e.g., "TASK - NAME")
          const match = this.extractOperativeAndTask(text, userMap);

          if (match) {
            if (!blockAddress || blockAddress.length < 5) {
              errors.push({
                row: r,
                cell: cellCoord,
                message: "Operative found but no property address detected in this block.",
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
              contract: blockScheme || "Gas Service",
              manager: blockManager,
              operative: match.user.originalName,
              operativeUid: match.user.uid,
              task: match.task,
              descriptionOfWorks: text,
              type: match.type,
              sourceCell: `${sheet.name}!${cellCoord}`,
              sourceSheet: sheet.name
            });
          } else {
            // Only flag as "Not Imported" if it looks like a work entry (contains a hyphen or is substantial text)
            // This avoids flagging simple admin notes or labels.
            if (text.includes('-') && text.length > 5) {
                errors.push({
                  row: r,
                  cell: cellCoord,
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

  private extractOperativeAndTask(text: string, userMap: UserMapEntry[]) {
    const upperText = text.toUpperCase();

    for (const user of userMap) {
      const name = user.originalName.toUpperCase();
      if (upperText.includes(name)) {
        let task = text;
        // Clean the task by removing the name and common prefixes
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

  private isHeaderJunk(val: any, columnDate: Date): boolean {
    if (val instanceof Date) return true;
    if (typeof val === 'number') return true; 
    
    const str = val.toString().toUpperCase();
    
    // Ignore rows that just repeat the day/month/date
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const days = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
    
    if (days.includes(str)) return true;
    if (str.length < 10 && months.some(m => str.includes(m))) return true;

    // Check if the string contains the year or matches a long date format
    if (str.includes('202') && (str.includes('/') || str.includes(' '))) return true;

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
