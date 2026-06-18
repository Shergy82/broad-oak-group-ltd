
import ExcelJS from 'exceljs';
import { type PlannerProfile, type StandardShift, type ImportError, type UserMapEntry } from '../types';

/**
 * Broad Oak Gas (Battleship) Profile
 * Logic: Global Date Header -> Section Boundaries -> Address Anchor -> Grid Mapping
 */
export class BroadOakProfile implements PlannerProfile {
  id = 'broad-oak';
  name = 'Broad Oak Gas (Battleship)';
  description = 'Hierarchical extraction: Finds global date headers at top, groups rows by SITE MANAGER, identifies addresses, and maps hyphenated work cells.';

  private postcodeRegex = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;
  private eNumberRegex = /\b[BE]\d{5,}\b/i;

  detect(workbook: ExcelJS.Workbook): boolean {
    return workbook.worksheets.some(sheet => this.detectSheet(sheet));
  }

  async parse(workbook: ExcelJS.Workbook, userMap: UserMapEntry[]): Promise<{ shifts: StandardShift[], errors: ImportError[] }> {
    const shifts: StandardShift[] = [];
    const errors: ImportError[] = [];
    
    // 1. Find the best sheet
    const sheet = workbook.worksheets.find(s => this.detectSheet(s)) || workbook.worksheets.find(s => s.state !== 'hidden');

    if (!sheet) {
        errors.push({ message: "No valid worksheet found.", severity: 'error', code: 'NO_SHEET' });
        return { shifts, errors };
    }

    errors.push({ message: `Processing sheet: "${sheet.name}"`, severity: 'info', code: 'SHEET_START' });

    // 2. Global Date Discovery (Scan top of sheet for headers)
    const dateColumnMap = new Map<number, Date>();
    let maxDatesFound = 0;
    let headerRowIndex = -1;

    for (let r = 1; r <= 30; r++) {
        const row = sheet.getRow(r);
        let datesInRow = 0;
        const tempMap = new Map<number, Date>();
        
        row.eachCell((cell, colNumber) => {
            if (colNumber >= 6) {
                const date = this.parseDate(cell.value);
                if (date) {
                    tempMap.set(colNumber, date);
                    datesInRow++;
                }
            }
        });

        if (datesInRow > maxDatesFound) {
            maxDatesFound = datesInRow;
            headerRowIndex = r;
            // Merge into master map
            tempMap.forEach((v, k) => dateColumnMap.set(k, v));
        }
    }

    if (dateColumnMap.size === 0) {
        errors.push({ message: "Could not find any date headers in columns F+. Expected format DD/MM/YY.", severity: 'error', code: 'NO_DATES' });
        return { shifts, errors };
    }

    errors.push({ message: `Mapped ${dateColumnMap.size} date columns from header row ${headerRowIndex}.`, severity: 'info', code: 'DATES_MAPPED' });

    // 3. Identify all Divider Rows (SITE MANAGER sections)
    const dividerRows: number[] = [];
    sheet.eachRow((row, rowNumber) => {
      const rowText = row.values ? row.values.toString().toUpperCase() : '';
      if (rowText.includes('SITE MANAGER') || rowText.includes('TECHNICAL MANAGER')) {
        dividerRows.push(rowNumber);
      }
    });

    if (dividerRows.length === 0) {
        // Fallback: If no SITE MANAGER, process as one big block
        dividerRows.push(headerRowIndex + 1);
    }

    // 4. Process each Block
    for (let i = 0; i < dividerRows.length; i++) {
      const startRow = dividerRows[i];
      const nextDividerRow = dividerRows[i + 1];
      const endRow = nextDividerRow ? nextDividerRow - 1 : sheet.rowCount;

      // --- Pass 1: Scan block for Address Anchor & Metadata ---
      let blockAddress = "";
      let blockENumber = "";
      let blockManager = "";
      let blockScheme = "";

      for (let r = startRow; r <= endRow; r++) {
        const row = sheet.getRow(r);
        
        // Scan Columns A-E for metadata
        for (let c = 1; r <= 5 && c <= 5; c++) {
            const val = row.getCell(c).value?.toString() || '';
            if (val.trim().length < 3) continue;

            // Manager
            if (val.toUpperCase().includes('SITE MANAGER')) {
                blockManager = val.split(':')[1]?.trim() || val.split('MANAGER')[1]?.trim() || blockManager;
            }

            // Scheme
            if (val.toUpperCase().includes('SCHEME') || val.toUpperCase().includes('CONTRACT')) {
                const schemeVal = row.getCell(c + 1).value?.toString().trim();
                if (schemeVal) blockScheme = schemeVal;
            }

            // Address Anchor
            const eMatch = val.match(this.eNumberRegex);
            if (eMatch) blockENumber = eMatch[0];
            
            if (this.postcodeRegex.test(val)) {
                blockAddress = val.trim();
            } else if (!blockAddress && val.length > 5 && !val.toUpperCase().includes('PHONE')) {
                // If it looks like an address but no postcode yet
                blockAddress = val.trim();
            }
        }
      }

      // --- Pass 2: Extract Shifts using Global Date Map ---
      for (let r = startRow; r <= endRow; r++) {
        const row = sheet.getRow(r);

        dateColumnMap.forEach((date, colNumber) => {
          const cell = row.getCell(colNumber);
          const cellValue = cell.value;
          if (!cellValue) return;

          const text = cellValue.toString().trim();
          if (text.length < 3) return;

          // Pattern Shield: Ignore headers
          if (this.isHeaderJunk(cellValue, date)) return;

          const match = this.extractOperativeAndTask(text, userMap);
          if (match) {
            if (!blockAddress) {
                errors.push({
                    row: r,
                    cell: `${this.getColumnLetter(colNumber)}${r}`,
                    message: `Shift found for "${match.user.originalName}" but no property address identified for row ${r}.`,
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
            // Log missing users
            if (text.includes('-') || text.includes('–') || text.includes('—')) {
                 errors.push({
                    row: r,
                    cell: `${this.getColumnLetter(colNumber)}${r}`,
                    message: `Operative not recognized in cell: "${text}"`,
                    severity: 'warning',
                    code: 'USER_NOT_FOUND',
                    rawValues: { text, address: blockAddress, date }
                });
            } else {
                // Info log for debug
                errors.push({
                    message: `Skipped non-shift cell at ${this.getColumnLetter(colNumber)}${r}: "${text}"`,
                    severity: 'debug',
                    code: 'SKIPPED_CELL'
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
    let markers = 0;
    for (let i = 1; i <= 50; i++) {
        const row = sheet.getRow(i);
        const rowText = row.values ? row.values.toString().toUpperCase() : '';
        if (rowText.includes('SITE MANAGER') || rowText.includes('CONTRACT') || rowText.includes('SCHEME')) {
            markers++;
        }
    }
    return markers > 0;
  }

  private extractOperativeAndTask(text: string, userMap: UserMapEntry[]) {
    const textUpper = text.toUpperCase();
    
    // Split by various hyphen types
    const parts = text.split(/[-–—]/).map(p => p.trim());
    
    for (const user of userMap) {
      const userName = user.originalName.toUpperCase();
      const firstName = user.originalName.split(' ')[0].toUpperCase();

      // Strategy 1: Hyphen Split (Task - Name)
      if (parts.length >= 2) {
          const lastPart = parts[parts.length - 1].toUpperCase();
          if (lastPart.includes(userName) || (lastPart.length > 3 && userName.includes(lastPart))) {
              return this.finalizeMatch(parts.slice(0, -1).join(' - '), user);
          }
      }

      // Strategy 2: Full Text Match (Inclusive)
      if (textUpper.includes(userName)) {
          let task = text.replace(new RegExp(user.originalName, 'gi'), '').replace(/[-–—]/g, '').trim();
          return this.finalizeMatch(task, user);
      }
      
      // Strategy 3: First Name Only (Dangerous but common in small teams)
      if (parts.length >= 2) {
          const lastPart = parts[parts.length - 1].toUpperCase();
          if (lastPart === firstName && firstName.length > 3) {
               return this.finalizeMatch(parts.slice(0, -1).join(' - '), user);
          }
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

    task = task.replace(/\b(AM|PM)\b/gi, '').replace(/^\s*[-:–—]\s*/, '').trim();

    return { user, task: task || "General Works", type };
  }

  private isHeaderJunk(val: any, columnDate: Date): boolean {
    if (!val) return true;
    const str = val.toString().toUpperCase();
    if (val instanceof Date) return true;
    
    const junk = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
    if (junk.some(j => str.includes(j))) return true;
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
