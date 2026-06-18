
import ExcelJS from 'exceljs';
import { type PlannerProfile, type StandardShift, type ImportError, type UserMapEntry } from '../types';

/**
 * Broad Oak Gas (Battleship) Profile - BLOCK-BASED REBUILD
 * Logic: Identify Section Boundaries -> Extract Block Address -> Map Shifts
 */
export class BroadOakProfile implements PlannerProfile {
  id = 'broad-oak';
  name = 'Broad Oak Gas (Battleship)';
  description = 'Hierarchical extraction: Groups rows by site dividers, finds address within block, then maps grid shifts.';

  private postcodeRegex = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;
  private eNumberRegex = /\bE\d{5,}\b/i;

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

      // --- Block Pass 1: Find Address Anchor and Metadata ---
      let blockAddress = "";
      let blockENumber = "";
      let blockManager = "";
      let blockScheme = "";
      const dateColumnMap = new Map<number, Date>();

      for (let r = startRow; i <= endRow; r++) {
        const row = sheet.getRow(r);
        const colA = row.getCell(1).value?.toString() || '';
        const colC = row.getCell(3).value?.toString() || '';
        const colD = row.getCell(4).value?.toString() || '';

        // Capture Address/E-ref (Prioritize rows with Postcodes)
        if (this.postcodeRegex.test(colA) || this.eNumberRegex.test(colA)) {
          blockAddress = colA.trim();
          const eMatch = colA.match(this.eNumberRegex);
          if (eMatch) blockENumber = eMatch[0];
        }

        // Capture Manager
        if (colA.toUpperCase().includes('SITE MANAGER')) {
          blockManager = colA.split(':')[1]?.trim() || "";
        }

        // Capture Scheme from Column C/D
        if (colC.toUpperCase().includes('SCHEME') || colC.toUpperCase().includes('CONTRACT')) {
          blockScheme = colD.trim() || "";
        }

        // Capture Dates (Check Row startRow specifically for horizontal headers)
        if (r === startRow) {
          row.eachCell((cell, colNumber) => {
            if (colNumber >= 6) {
              const date = this.parseDate(cell.value);
              if (date) dateColumnMap.set(colNumber, date);
            }
          });
        }
      }

      // --- Block Pass 2: Extract Shifts ---
      for (let r = startRow; r <= endRow; r++) {
        const row = sheet.getRow(r);

        dateColumnMap.forEach((date, colNumber) => {
          const cell = row.getCell(colNumber);
          const cellValue = cell.value;
          if (!cellValue) return;

          const cellCoord = `${this.getColumnLetter(colNumber)}${r}`;

          // SHIELD: Skip if cell is just a date repetition (the "329 Not Imported" bug)
          if (this.isDateOrHeaderRepeat(cellValue, date)) return;

          const text = cellValue.toString().trim();
          if (text.length < 3) return;

          // EXTRACT: Match Operative Name from Text
          const match = this.extractOperativeAndTask(text, userMap);

          if (match) {
            if (!blockAddress) {
                // If we found an operative but still no address in the block, 
                // it's a structural error in the sheet.
                errors.push({
                    row: r,
                    cell: cellCoord,
                    message: "Operative found but no site address detected in this section.",
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
              contract: blockScheme || "General",
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
            // Only flag as "Not Imported" if it looks like a work entry (contains common task words or a hyphen)
            if (text.includes('-') || text.length > 5) {
                errors.push({
                  row: r,
                  cell: cellCoord,
                  message: `Operative name not recognized in text: "${text.substring(0, 30)}..."`,
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
        // Clean the task by removing the name and prefixes
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
    if (typeof val === 'number') return true; 
    
    const str = val.toString().toUpperCase();
    // Ignore strings that look like date headers (e.g., "Thu Jun 18")
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const days = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
    
    const hasMonth = months.some(m => str.includes(m));
    const hasDay = days.some(d => str.includes(d));
    const hasYear = str.includes('202');

    return (hasMonth && hasDay) || (hasMonth && hasYear);
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
