import ExcelJS from 'exceljs';
import { type PlannerProfile, type StandardShift, type ImportError, type UserMapEntry } from '../types';

export class BroadOakProfile implements PlannerProfile {
  id = 'broad-oak';
  name = 'Broad Oak Gas (Battleship)';
  description = 'Hierarchical extraction: Groups rows by dividers and identifies the property address from the last box in Column A of that section.';

  private eNumberRegex = /\b[BE]\d{5,}\b/i;

  detect(workbook: ExcelJS.Workbook): boolean {
    return workbook.worksheets.some(sheet => {
      if (sheet.state === 'hidden') return false;
      for (let i = 1; i <= 30; i++) {
        const rowText = sheet.getRow(i).values?.toString().toUpperCase() || '';
        if (rowText.includes('SITE MANAGER') || rowText.includes('DIVIDING LINE')) return true;
      }
      return false;
    });
  }

  async parse(workbook: ExcelJS.Workbook, userMap: UserMapEntry[]): Promise<{ shifts: StandardShift[], errors: ImportError[] }> {
    const shifts: StandardShift[] = [];
    const errors: ImportError[] = [];
    const sheet = workbook.worksheets.find(s => s.state !== 'hidden' && this.detectSheet(s)) || workbook.worksheets.find(s => s.state !== 'hidden');
    if (!sheet) return { shifts, errors: [{ message: "No valid sheet found.", severity: 'error', code: 'NO_SHEET' }] };

    const dateColumnMap = new Map<number, Date>();
    for (let r = 1; r <= 30; r++) {
      const row = sheet.getRow(r);
      row.eachCell((cell, colNumber) => {
        if (colNumber >= 6) {
          const date = this.parseDate(cell.value);
          if (date) dateColumnMap.set(colNumber, date);
        }
      });
    }

    const dividerRows: number[] = [];
    sheet.eachRow((row, rowNumber) => {
      const rowText = row.values ? row.values.toString().toUpperCase() : '';
      if (rowText.includes('SITE MANAGER') || rowText.includes('DIVIDING LINE')) dividerRows.push(rowNumber);
    });
    if (dividerRows.length === 0) dividerRows.push(1);

    for (let i = 0; i < dividerRows.length; i++) {
      const startRow = dividerRows[i];
      const nextDivider = dividerRows[i + 1];
      const endRow = nextDivider ? nextDivider - 1 : sheet.rowCount;

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
        // Address is always the LAST box in Column A
        if (colA && colA.length > 5 && !colA.toUpperCase().includes('MANAGER') && !colA.toUpperCase().includes('DIVIDING')) {
          blockAddress = colA;
          const eMatch = colA.match(this.eNumberRegex);
          if (eMatch) {
            blockENumber = eMatch[0];
            blockAddress = colA.replace(this.eNumberRegex, '').replace(/^\s*[-:–—]\s*/, '').trim();
          }
        }
      }

      for (let r = startRow; r <= endRow; r++) {
        const row = sheet.getRow(r);
        dateColumnMap.forEach((date, colNumber) => {
          const cell = row.getCell(colNumber);
          if (!cell.value) return;
          const text = cell.value.toString().trim();
          if (text.length < 3 || this.isHeaderJunk(cell.value, date)) return;

          const match = this.extractOperativeAndTask(text, userMap);
          if (match) {
            if (!blockAddress) {
              errors.push({ row: r, cell: `${this.getColumnLetter(colNumber)}${r}`, message: "Missing property address.", severity: 'warning', code: 'MISSING_ADDRESS' });
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
      if (hyphens.test(text)) {
        const parts = text.split(hyphens).map(p => p.trim());
        const lastPart = parts[parts.length - 1].toUpperCase();
        if (lastPart.includes(name) || (lastPart.length > 4 && name.includes(lastPart))) {
          return this.finalizeMatch(parts.slice(0, -1).join(' - '), user);
        }
      }
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
    return junk.some(j => str.includes(j)) || str === columnDate.getDate().toString();
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