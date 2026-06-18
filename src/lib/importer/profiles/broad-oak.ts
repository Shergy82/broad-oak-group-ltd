import ExcelJS from 'exceljs';
import { type PlannerProfile, type StandardShift, type ImportError, type UserMapEntry } from '../types';

export class BroadOakProfile implements PlannerProfile {
  id = 'broad-oak';
  name = 'Broad Oak Gas';
  description = 'Reads Broad Oak Gas planners by date rows and site blocks across all visible tabs.';

  private eNumberRegex = /\b[BE]\d{4,}\b/i;

  private nicknameMap: Record<string, string[]> = {
    PHILIP: ['PHIL'],
    DAVID: ['DAVE'],
    ROBERT: ['ROB', 'BOB'],
    MICHAEL: ['MIKE'],
    STEPHEN: ['STEVE'],
    STEVEN: ['STEVE'],
    CHRISTOPHER: ['CHRIS'],
    ANTHONY: ['TONY'],
    MATTHEW: ['MATT'],
    DANIEL: ['DAN'],
    ANDREW: ['ANDY'],
    JONATHAN: ['JON'],
    RICHARD: ['RICH', 'RICK'],
    WILLIAM: ['WILL', 'BILL'],
    THOMAS: ['TOM'],
  };

  detect(workbook: ExcelJS.Workbook): boolean {
    return workbook.worksheets.some((sheet) => {
      if (sheet.state === 'hidden') return false;
      return this.findDateRows(sheet).length > 0;
    });
  }

  async parse(
    workbook: ExcelJS.Workbook,
    userMap: UserMapEntry[]
  ): Promise<{ shifts: StandardShift[]; errors: ImportError[] }> {
    const shifts: StandardShift[] = [];
    const errors: ImportError[] = [];
    const today = this.startOfToday();

    for (const sheet of workbook.worksheets) {
      if (sheet.state === 'hidden') continue;

      const lastUsedRow = this.getLastUsedRow(sheet);
      if (lastUsedRow === 0) continue;

      const dateRows = this.findDateRows(sheet);
      if (dateRows.length === 0) continue;

      for (let blockIndex = 0; blockIndex < dateRows.length; blockIndex++) {
        const dateRowIndex = dateRows[blockIndex];
        const nextDateRowIndex = dateRows[blockIndex + 1];
        const dateColumnMap = this.mapDatesOnRow(sheet, dateRowIndex);

        if (dateColumnMap.size === 0) continue;

        const startRow = dateRowIndex + 1;
        const endRow = nextDateRowIndex ? nextDateRowIndex - 2 : lastUsedRow;

        if (endRow < startRow) continue;

        const addressInfo = this.extractAddress(sheet, startRow, endRow);
        const manager = this.extractManager(sheet, startRow, endRow);
        const contract = this.extractScheme(sheet, startRow, endRow) || 'Gas Works';

        for (let r = startRow; r <= endRow; r++) {
          const row = sheet.getRow(r);

          dateColumnMap.forEach((date, colNumber) => {
            const shiftDate = this.startOfDay(date);
            if (shiftDate < today) return;

            const cell = row.getCell(colNumber);
            const text = this.getCellText(cell);

            if (!text || text.length < 3) return;
            if (this.isHeaderJunk(text, date)) return;

            const match = this.extractOperativeAndTask(text, userMap);

            if (!match) {
              errors.push({
                row: r,
                cell: `${this.getColumnLetter(colNumber)}${r}`,
                message: 'No matching operative found.',
                severity: 'warning',
                code: 'UNKNOWN_OPERATIVE',
                rawValues: { text },
              });
              return;
            }

            if (!addressInfo.address) {
              errors.push({
                row: r,
                cell: `${this.getColumnLetter(colNumber)}${r}`,
                message: 'Found shift but no property address identified in this section.',
                severity: 'warning',
                code: 'MISSING_ADDRESS',
                rawValues: { text },
              });
              return;
            }

            shifts.push({
              date: shiftDate,
              address: addressInfo.address,
              eNumber: addressInfo.eNumber,
              contract,
              manager,
              operative: match.user.originalName,
              operativeUid: match.user.uid,
              task: match.task,
              descriptionOfWorks: text,
              type: match.type,
              sourceCell: `${sheet.name}!${this.getColumnLetter(colNumber)}${r}`,
              sourceSheet: sheet.name,
            });
          });
        }
      }
    }

    return { shifts, errors };
  }

  private getLastUsedRow(sheet: ExcelJS.Worksheet): number {
    let lastRow = 0;

    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      let hasRealValue = false;

      row.eachCell({ includeEmpty: false }, (cell) => {
        if (this.getCellText(cell)) hasRealValue = true;
        if (this.parseDateFromCell(cell)) hasRealValue = true;
      });

      if (hasRealValue) lastRow = rowNumber;
    });

    return lastRow;
  }

  private findDateRows(sheet: ExcelJS.Worksheet): number[] {
    const rows: number[] = [];

    sheet.eachRow({ includeEmpty: false }, (_row, rowNumber) => {
      const dates = this.mapDatesOnRow(sheet, rowNumber);
      if (dates.size >= 2) rows.push(rowNumber);
    });

    return rows;
  }

  private mapDatesOnRow(sheet: ExcelJS.Worksheet, rowNumber: number): Map<number, Date> {
    const map = new Map<number, Date>();
    const row = sheet.getRow(rowNumber);

    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const date = this.parseDateFromCell(cell);
      if (date) map.set(colNumber, date);
    });

    return map;
  }

  private extractAddress(
    sheet: ExcelJS.Worksheet,
    startRow: number,
    endRow: number
  ): { address: string; eNumber: string } {
    let bestText = '';
    let eNumber = '';

    for (let r = startRow; r <= endRow; r++) {
      const text = this.getCellText(sheet.getRow(r).getCell(1));
      if (!text) continue;

      const upper = text.toUpperCase();

      if (
        upper.includes('SITE MANAGER') ||
        upper.includes('TECHNICAL MANAGER') ||
        upper.includes('MATERIAL') ||
        upper.includes('TLO') ||
        upper.includes('SCHEME') ||
        upper.includes('ON LIVE') ||
        upper.includes('START DATE') ||
        upper.includes('MEASURES')
      ) {
        continue;
      }

      if (text.length > bestText.length) bestText = text;
    }

    if (bestText) {
      const match = bestText.match(this.eNumberRegex);

      if (match) {
        eNumber = match[0];
        bestText = bestText
          .replace(this.eNumberRegex, '')
          .replace(/^\s*[-:–—]\s*/, '')
          .trim();
      }
    }

    return { address: bestText, eNumber };
  }

  private extractManager(sheet: ExcelJS.Worksheet, startRow: number, endRow: number): string {
    for (let r = startRow; r <= endRow; r++) {
      const text = this.getCellText(sheet.getRow(r).getCell(1));

      if (text.toUpperCase().includes('SITE MANAGER')) {
        return text
          .replace(/SITE MANAGER/gi, '')
          .replace(/[:\-–—]/g, '')
          .trim();
      }
    }

    return '';
  }

  private extractScheme(sheet: ExcelJS.Worksheet, startRow: number, endRow: number): string {
    for (let r = startRow; r <= endRow; r++) {
      const row = sheet.getRow(r);

      for (let c = 1; c <= Math.min(sheet.columnCount, 12); c++) {
        const text = this.getCellText(row.getCell(c)).toUpperCase();

        if (text.includes('SCHEME') || text.includes('CONTRACT')) {
          const nextCell = this.getCellText(row.getCell(c + 1));
          if (nextCell) return nextCell;
        }
      }
    }

    return '';
  }

  private extractOperativeAndTask(
    text: string,
    userMap: UserMapEntry[]
  ): { user: UserMapEntry; task: string; type: 'am' | 'pm' | 'all-day' } | null {
    const normalizedText = this.normalizeName(text);

    for (const user of userMap) {
      const originalName = user.originalName || '';
      const normalizedOriginalName = this.normalizeName(originalName);

      if (normalizedOriginalName && normalizedText.includes(normalizedOriginalName)) {
        const task = text
          .replace(new RegExp(this.escapeRegExp(originalName), 'gi'), '')
          .replace(/[-–—]/g, '')
          .trim();

        return this.finalizeMatch(task, user);
      }

      const parts = originalName.toUpperCase().split(/\s+/).filter(Boolean);
      const firstName = parts[0] || '';
      const lastName = parts[parts.length - 1] || '';

      if (firstName && lastName) {
        const normalFirst = this.normalizeName(firstName);
        const normalLast = this.normalizeName(lastName);

        if (normalizedText.includes(normalFirst) && normalizedText.includes(normalLast)) {
          const task = text
            .replace(new RegExp(this.escapeRegExp(firstName), 'gi'), '')
            .replace(new RegExp(this.escapeRegExp(lastName), 'gi'), '')
            .replace(/[-–—]/g, '')
            .trim();

          return this.finalizeMatch(task, user);
        }

        const nicknames = this.nicknameMap[firstName] || [];

        for (const nickname of nicknames) {
          const nicknameFull = this.normalizeName(`${nickname} ${lastName}`);

          if (nicknameFull && normalizedText.includes(nicknameFull)) {
            const task = text
              .replace(new RegExp(this.escapeRegExp(nickname), 'gi'), '')
              .replace(new RegExp(this.escapeRegExp(lastName), 'gi'), '')
              .replace(/[-–—]/g, '')
              .trim();

            return this.finalizeMatch(task, user);
          }
        }
      }

      if (user.normalizedName) {
        const savedNormalizedName = this.normalizeName(user.normalizedName);

        if (savedNormalizedName && normalizedText.includes(savedNormalizedName)) {
          return this.finalizeMatch('General Works', user);
        }
      }
    }

    return null;
  }

  private finalizeMatch(rawTask: string, user: UserMapEntry) {
    let task = rawTask || 'General Works';
    let type: 'am' | 'pm' | 'all-day' = 'all-day';

    if (/\bAM\b/i.test(task)) type = 'am';
    else if (/\bPM\b/i.test(task)) type = 'pm';

    task = task
      .replace(/\b(AM|PM)\b/gi, '')
      .replace(/^\s*[-:–—]\s*/, '')
      .trim();

    return {
      user,
      task: task || 'General Works',
      type,
    };
  }

  private getCellText(cell: ExcelJS.Cell): string {
    const masterCell = this.getMasterCell(cell);
    const value = masterCell.value;

    if (value === null || value === undefined) {
      return masterCell.text?.toString().trim() || '';
    }

    if (value instanceof Date) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number') return value.toString().trim();

    if (typeof value === 'object') {
      const richText = (value as any).richText;
      if (Array.isArray(richText)) {
        return richText.map((item: any) => item.text || '').join('').trim();
      }

      const result = (value as any).result;
      if (result !== undefined && result !== null) return result.toString().trim();

      const text = (value as any).text;
      if (text !== undefined && text !== null) return text.toString().trim();
    }

    return masterCell.text?.toString().trim() || value.toString().trim();
  }

  private getMasterCell(cell: ExcelJS.Cell): ExcelJS.Cell {
    const anyCell = cell as any;
    return anyCell.master ? (anyCell.master as ExcelJS.Cell) : cell;
  }

  private parseDateFromCell(cell: ExcelJS.Cell): Date | null {
    const masterCell = this.getMasterCell(cell);

    const fromValue = this.parseDate(masterCell.value);
    if (fromValue) return fromValue;

    const fromText = this.parseDate(masterCell.text);
    if (fromText) return fromText;

    return null;
  }

  private parseDate(value: any): Date | null {
    if (value instanceof Date) {
      return new Date(value.getFullYear(), value.getMonth(), value.getDate());
    }

    if (typeof value === 'number') {
      if (value < 20000 || value > 80000) return null;

      const date = new Date(Math.round((value - 25569) * 864e5));
      return new Date(date.getFullYear(), date.getMonth(), date.getDate());
    }

    if (typeof value === 'string') {
      const match = value.trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);

      if (match) {
        let year = parseInt(match[3], 10);
        if (year < 100) year += 2000;

        return new Date(year, parseInt(match[2], 10) - 1, parseInt(match[1], 10));
      }
    }

    if (typeof value === 'object' && value !== null) {
      const text = (value as any).text;
      if (text) return this.parseDate(text);

      const result = (value as any).result;
      if (result) return this.parseDate(result);
    }

    return null;
  }

  private isHeaderJunk(text: string, columnDate: Date): boolean {
    const str = text.toUpperCase().trim();

    const junk = [
      'JANUARY',
      'FEBRUARY',
      'MARCH',
      'APRIL',
      'MAY',
      'JUNE',
      'JULY',
      'AUGUST',
      'SEPTEMBER',
      'OCTOBER',
      'NOVEMBER',
      'DECEMBER',
      'MONDAY',
      'TUESDAY',
      'WEDNESDAY',
      'THURSDAY',
      'FRIDAY',
      'SATURDAY',
      'SUNDAY',
      'MON',
      'TUE',
      'WED',
      'THU',
      'FRI',
      'SAT',
      'SUN',
    ];

    if (junk.some((item) => str.includes(item))) return true;
    if (str === columnDate.getDate().toString()) return true;

    return false;
  }

  private startOfToday(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  private startOfDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  private normalizeName(value: string): string {
    return value.toUpperCase().replace(/[^A-Z]/g, '').trim();
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private getColumnLetter(col: number): string {
    let letter = '';

    while (col > 0) {
      const temp = (col - 1) % 26;
      letter = String.fromCharCode(temp + 65) + letter;
      col = (col - temp - 1) / 26;
    }

    return letter;
  }
}