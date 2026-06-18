
import ExcelJS from 'exceljs';
import { type PlannerProfile, type StandardShift, type ImportError, type UserMapEntry } from '../types';

/**
 * Broad Oak Gas (Battleship) Profile
 * Rule: Address is the LAST populated cell in Column A within a project section.
 */
export class BroadOakProfile implements PlannerProfile {
  id = 'broad-oak';
  name = 'Broad Oak Gas (Battleship)';
  description = 'Hierarchical extraction: Groups rows by dividers and identifies the property address from the last cell in Column A of that section.';

  private eNumberRegex = /\b[BE]\d{5,}\b/i;

  detect(workbook: ExcelJS.Workbook): boolean {
    return workbook.worksheets.some(sheet => {
        if (sheet.state === 'hidden') return false;
        let found = false;
        for (let i = 1; i <= 30; i++) {
            const rowText = sheet.getRow(i).values?.toString().toUpperCase() || '';
            if (rowText.includes('SITE MANAGER') || rowText.includes('DIVIDING LINE')) {
                found = true;
                break;
            }
        }
        return found;
    });
  }

  async parse(workbook: ExcelJS.Workbook, userMap: UserMapEntry[]): Promise<{ shifts: StandardShift[], errors: ImportError[] }> {
    const shifts: StandardShift[] = [];
    const errors: ImportError[] = [];
    
    const sheet = workbook.worksheets.find(s => s.state !== 'hidden' && this.detectSheet(s)) || workbook.worksheets.find(s => s.state !== 'hidden');

    if (!sheet) {
        errors.push({ message: "No valid worksheet found.", severity: 'error', code: 'NO_SHEET' });
        return { shifts, errors };
    }

    // 1. Map Global Date Headers (Rows 1-30)
    const dateColumnMap = new Map<number, Date>();
    let dateRowIndex = -1;

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

        if (datesInRow > (dateColumnMap.size || 0)) {
            dateRowIndex = r;
            tempMap.forEach((v, k) => dateColumnMap.set(k, v));
        }
    }

    if (dateColumnMap.size === 0) {
        errors.push({ message: "No dates found in columns F onwards.", severity: 'error', code: 'NO_DATES' });
        return { shifts, errors };
    }

    // 2. Identify Section Dividers
    const dividerRows: number[] = [];
    sheet.eachRow((row, rowNumber) => {
      const rowText = row.values ? row.values.toString().toUpperCase() : '';
      if (rowText.includes('SITE MANAGER') || rowText.includes('DIVIDING LINE')) {
        dividerRows.push(rowNumber);
      }
    });

    if (dividerRows.length === 0) {
        dividerRows.push(dateRowIndex + 1);
    }

    // 3. Process Blocks
    for (let i = 0; i < dividerRows.length; i++) {
      const startRow = dividerRows[i];
      const nextDividerRow = dividerRows[i + 1];
      const endRow = nextDividerRow ? nextDividerRow - 1 : sheet.rowCount;

      // Pass 1: Extract Metadata (Address is the LAST box in Col A)
      let blockAddress = "";
      let blockENumber = "";
      let blockManager = "";
      let blockScheme = "";

      for (let r = startRow; r <= endRow; r++) {
        const row = sheet.getRow(r);
        const colA = row.getCell(1).value?.toString().trim();
        const colC = row.getCell(3).value?.toString().trim();

        if (colA?.toUpperCase().includes('SITE MANAGER')) {
            blockManager = colA.split(':')[1]?.trim() || colA.split('MANAGER')[1]?.trim() || blockManager;
        }

        if (colC?.toUpperCase().includes('SCHEME') || colC?.toUpperCase().includes('CONTRACT')) {
            blockScheme = row.getCell(4).value?.toString().trim() || blockScheme;
        }

        // Rule: Last populated box in A is the address
        if (colA && colA.length > 5 && !colA.toUpperCase().includes('MANAGER') && !colA.toUpperCase().includes('DIVIDING')) {
            blockAddress = colA;
            const eMatch = colA.match(this.eNumberRegex);
            if (eMatch) {
                blockENumber = eMatch[0];
                blockAddress = colA.replace(this.eNumberRegex, '').replace(/^\s*[-:–—]\s*/, '').trim();
            }
        }
      }

      // Pass 2: Extract Work Cells
      for (let r = startRow; r <= endRow; r++) {
        const row = sheet.getRow(r);

        dateColumnMap.forEach((date, colNumber) => {
          const cell = row.getCell(colNumber);
          if (!cell.value) return;

          const text = cell.value.toString().trim();
          if (text.length < 3) return;

          // Skip cells that just repeat header dates
          if (this.isHeaderJunk(cell.value, date)) return;

          const match = this.extractOperativeAndTask(text, userMap);
          if (match) {
            if (!blockAddress) {
                errors.push({
                    row: r,
                    cell: `${this.getColumnLetter(colNumber)}${r}`,
                    message: "Found shift but no property address identified in this section.",
                    severity: 'warning',
                    code: 'MISSING_ADDRESS',
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
              operativeUid: match.user.uid, // This is the Auth UID
              task: match.task,
              descriptionOfWorks: text,
              type: match.type,
              sourceCell: `${sheet.name}!${this.getColumnLetter(colNumber)}${r}`,
              sourceSheet: sheet.name
            });
          }
        });
      }
    }

    return { shifts, errors };
  }

  private detectSheet(sheet: ExcelJS.Worksheet): boolean {
    for (let i = 1; i <= 30; i++) {
        const rowText = sheet.getRow(i).values?.toString().toUpperCase() || '';
        if (rowText.includes('SITE MANAGER') || rowText.includes('DIVIDING LINE')) return true;
    }
    return false;
  }

  private extractOperativeAndTask(text: string, userMap: UserMapEntry[]) {
    const textUpper = text.toUpperCase();
    const hyphens = /[-–—]/;
    
    for (const user of userMap) {
      const name = user.originalName.toUpperCase();
      
      // Strategy 1: Hyphen Split
      if (hyphens.test(text)) {
          const parts = text.split(hyphens).map(p => p.trim());
          const lastPart = parts[parts.length - 1].toUpperCase();
          if (lastPart.includes(name) || (lastPart.length > 4 && name.includes(lastPart))) {
              return this.finalizeMatch(parts.slice(0, -1).join(' - '), user);
          }
      }

      // Strategy 2: Full text inclusion
      if (textUpper.includes(name)) {
          const task = text.replace(new RegExp(user.originalName, 'gi'), '').replace(hyphens, '').trim();
          return this.finalizeMatch(task, user);
      }
    }
    return null;
  }

  private finalizeMatch(rawTask: string, user: UserMapEntry) {
    let task = rawTask || "General Works";
    let type: 'am' | 'pm' | 'all-day' = 'all-day';
    
    if (task.toUpperCase().includes('AM')) type = 'am';
    else if (task.toUpperCase().includes('PM')) type = 'pm';

    task = task.replace(/\b(AM|PM)\b/gi, '').replace(/^\s*[-:–—]\s*/, '').trim();
    return { user, task: task || "General Works", type };
  }

  private isHeaderJunk(val: any, columnDate: Date): boolean {
    if (val instanceof Date) return true;
    const str = val.toString().toUpperCase();
    const junk = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
    if (junk.some(j => str.includes(j))) return true;
    if (str === columnDate.getDate().toString()) return true;
    return false;
  }

  private parseDate(val: any): Date | null {
    if (val instanceof Date) return val;
    if (typeof val === 'number') return new Date(Math.round((val - 25569) * 864e5));
    if (typeof val === 'string') {
        const m = val.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
        if (m) {
            let y = parseInt(m[3], 10);
            if (y < 100) y += 2000;
            return new Date(y, parseInt(m[2], 10) - 1, parseInt(m[1], 10));
        }
    }
    return null;
  }

  private getColumnLetter(col: number): string {
    let letter = '';
    while (col > 0) {
      let t = (col - 1) % 26;
      letter = String.fromCharCode(t + 65) + letter;
      col = (col - t - 1) / 26;
    }
    return letter;
  }
}
