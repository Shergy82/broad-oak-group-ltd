/**
 * GAS PLANNER IMPORT PROFILE
 *
 * Gas-only planner profile.
 * This version is designed to read visible shift text more safely, especially
 * around merged cells, deep rows, text/formula date headers, and final site blocks.
 *
 * This profile is locked because the Gas planner reconciliation logic is currently working correctly.
 * Do not alter this file when changing Build planner behaviour.
 * Build planner changes must be made in the Build profile only.
 */

import ExcelJS from 'exceljs';
import { format } from 'date-fns';
import { type PlannerProfile, type StandardShift, type ImportError, type UserMapEntry } from '../types';
import {
  normaliseText,
  normaliseName,
  formatDateKey,
  getTodayDateKey,
  findSafeUserMatch,
  getColumnLetter
} from '../core/utils';

type DateColumnInfo = {
  date: Date;
  dateKey: string;
};

export class GasProfile implements PlannerProfile {
  id = 'gas-planner';
  name = 'Gas Department Planner';
  description = 'Profile for the Gas department sheet layout.';

  private eNumberRegex = /\b[BE]\d{5,}\b/i;

  detect(workbook: ExcelJS.Workbook): boolean {
    return workbook.worksheets.some(sheet => {
      if (sheet.state === 'hidden') return false;

      const { maxRows, maxCols } = this.getScanBounds(sheet);

      for (let r = 1; r <= Math.min(maxRows, 1000); r++) {
        const rowText = this.getRowText(sheet.getRow(r), 1, Math.min(maxCols, 25)).toUpperCase();

        if (rowText.includes('SITE MANAGER') || rowText.includes('DIVIDING LINE')) {
          return true;
        }
      }

      return false;
    });
  }

  async parse(
    workbook: ExcelJS.Workbook,
    userMap: UserMapEntry[]
  ): Promise<{ shifts: StandardShift[]; errors: ImportError[] }> {
    const shifts: StandardShift[] = [];
    const errors: ImportError[] = [];
    const todayKey = getTodayDateKey();

    const processedVisualCells = new Set<string>();
    const seenShiftKeys = new Set<string>();

    const sheet =
      workbook.worksheets.find(s => s.state !== 'hidden' && this.isPlannerSheet(s)) ||
      workbook.worksheets.find(s => s.state !== 'hidden');

    if (!sheet) {
      errors.push({
        message: 'No valid worksheet found.',
        severity: 'error',
        code: 'NO_SHEET'
      });
      return { shifts, errors };
    }

    const { maxRows, maxCols } = this.getScanBounds(sheet);

    const dateColumnMap = new Map<number, DateColumnInfo>();
    let dateRowIndex = -1;

    /**
     * Find the row containing the most date headers.
     * Important fixes:
     * - Scans actual column positions, not just non-empty eachCell callbacks.
     * - Accepts Excel dates, serial numbers, formula results, and text dates.
     */
    for (let r = 1; r <= Math.min(maxRows, 1000); r++) {
      const row = sheet.getRow(r);
      const tempMap = new Map<number, DateColumnInfo>();

      // Scan from F (6) to the end of the sheet
      for (let colNumber = 6; colNumber <= maxCols; colNumber++) {
        const cell = row.getCell(colNumber);
        const actualCell = this.getActualCell(cell);
        const date = this.parseDateValue(actualCell.value);

        if (!date) continue;

        const dateKey = formatDateKey(date);
        tempMap.set(colNumber, { date, dateKey });
      }

      if (tempMap.size > dateColumnMap.size) {
        dateRowIndex = r;
        dateColumnMap.clear();
        tempMap.forEach((value, key) => dateColumnMap.set(key, value));
      }
    }

    if (dateColumnMap.size === 0 || dateRowIndex < 0) {
      errors.push({
        message: 'No dates found in header row from column F onwards.',
        severity: 'error',
        code: 'NO_DATES'
      });
      return { shifts, errors };
    }

    /**
     * Find all Gas site block divider rows.
     */
    const dividerRows: number[] = [];

    for (let r = 1; r <= maxRows; r++) {
      const rowText = this.getRowText(sheet.getRow(r), 1, Math.min(maxCols, 25)).toUpperCase();

      if (rowText.includes('SITE MANAGER') || rowText.includes('DIVIDING LINE')) {
        dividerRows.push(r);
      }
    }

    if (dividerRows.length === 0) {
      dividerRows.push(dateRowIndex + 1);
    }

    for (let i = 0; i < dividerRows.length; i++) {
      const startRow = dividerRows[i];
      const nextDividerRow = dividerRows[i + 1];

      /**
       * If there is another divider, stop immediately before it.
       * If this is the final block, scan forward until a large blank run is reached.
       */
      const hardEndRow = nextDividerRow ? nextDividerRow - 1 : maxRows;
      const endRow = nextDividerRow
        ? hardEndRow
        : this.findLastUsefulRowInFinalBlock(sheet, startRow, hardEndRow, dateColumnMap);

      let blockAddress = '';
      let blockENumber = '';
      let blockManager = '';
      let blockScheme = '';

      /**
       * Extract site metadata from the top of the site block.
       */
      for (let r = startRow; r <= Math.min(startRow + 20, endRow); r++) {
        const row = sheet.getRow(r);

        const colA = this.getCellText(row.getCell(1));
        const colC = this.getCellText(row.getCell(3));
        const colD = this.getCellText(row.getCell(4));
        const rowText = this.getRowText(row, 1, 8);

        if (colA.toUpperCase().includes('SITE MANAGER')) {
          blockManager =
            colA.split(':')[1]?.trim() ||
            colA.split(/SITE MANAGER/i)[1]?.trim() ||
            blockManager;
        }

        if (colC.toUpperCase().includes('SCHEME') || colC.toUpperCase().includes('CONTRACT')) {
          blockScheme = colD || blockScheme;
        }

        const eMatch = rowText.match(this.eNumberRegex);
        if (eMatch && !blockENumber) {
          blockENumber = eMatch[0];
        }

        if (
          colA &&
          colA.length > 5 &&
          !colA.toUpperCase().includes('SITE MANAGER') &&
          !colA.toUpperCase().includes('DIVIDING LINE')
        ) {
          const eNumberInAddress = colA.match(this.eNumberRegex);

          if (eNumberInAddress) {
            blockENumber = blockENumber || eNumberInAddress[0];
            blockAddress = colA
              .replace(this.eNumberRegex, '')
              .replace(/^\s*[-:–—]\s*/, '')
              .trim();
          } else if (!blockAddress) {
            blockAddress = colA;
          }
        }
      }

      /**
       * Scan every visible row/cell in the site block.
       */
      for (let r = startRow; r <= endRow; r++) {
        const row = sheet.getRow(r);

        dateColumnMap.forEach(({ date, dateKey }, colNumber) => {
          const visualCell = row.getCell(colNumber);
          const actualCell = this.getActualCell(visualCell);
          const text = this.getCellText(actualCell);

          if (!text) return;

          /**
           * Do not import historic shifts.
           */
          if (dateKey < todayKey) return;

          /**
           * Only hyphenated entries are shift attempts.
           */
          if (!text.includes('-')) return;

          // Deduplicate visual cells (especially for merged cells spanning multiple dates or rows)
          const visualCellKey = `${sheet.name}|${actualCell.address}|${dateKey}`;
          if (processedVisualCells.has(visualCellKey)) return;
          processedVisualCells.add(visualCellKey);

          const lastHyphenIndex = text.lastIndexOf('-');
          const taskPart = text.substring(0, lastHyphenIndex).trim();
          const namePart = text.substring(lastHyphenIndex + 1).trim();

          const context = {
            row: r,
            cell: actualCell.address,
            sheet: sheet.name,
            date: format(date, 'dd/MM/yyyy'),
            dateKey,
            address: blockAddress || 'Unknown Address',
            task: taskPart
          };

          if (!taskPart && namePart) {
            errors.push({
              ...context,
              message: 'Missing task/description',
              severity: 'error',
              code: 'VAL_ERROR',
              operative: namePart
            });
            return;
          }

          if (taskPart && !namePart) {
            errors.push({
              ...context,
              message: 'Missing operative after separator',
              severity: 'error',
              code: 'VAL_ERROR',
              operative: '—'
            });
            return;
          }

          const matchedUser = findSafeUserMatch(namePart, userMap);

          if (!matchedUser) {
            const norm = normaliseName(namePart);
            const parts = norm.split(' ').filter(Boolean);
            const exactMatches = userMap.filter(u => normaliseName(u.originalName) === norm);

            let reason = `Operative not recognised: ${namePart}`;

            if (exactMatches.length > 1) {
              reason = `Multiple registered users match: ${namePart}`;
            } else if (parts.length < 2) {
              reason = `Operative name too vague: ${namePart}`;
            }

            errors.push({
              ...context,
              message: reason,
              severity: 'error',
              code: 'USER_NOT_FOUND',
              operative: namePart
            });
            return;
          }

          const localDuplicateKey = [
            dateKey,
            normaliseText(blockENumber),
            normaliseText(blockAddress),
            matchedUser.uid,
            normaliseText(taskPart)
          ].join('|');

          if (seenShiftKeys.has(localDuplicateKey)) return;
          seenShiftKeys.add(localDuplicateKey);

          shifts.push({
            date,
            dateKey,
            address: blockAddress || 'Unknown Address',
            eNumber: blockENumber,
            contract: blockScheme || 'Planner Works',
            manager: blockManager,
            operative: matchedUser.originalName,
            operativeUid: matchedUser.uid,
            userId: matchedUser.uid,
            userName: matchedUser.originalName,
            task: taskPart,
            descriptionOfWorks: text,
            type: this.detectType(taskPart),
            sourceCell: context.cell,
            sourceSheet: sheet.name,
            sourcePlannerId: sheet.name,
            sourcePlannerName: sheet.name,
            plannerName: sheet.name,
            profileId: this.id,
            importKey: localDuplicateKey,
            startTime: '',
            endTime: ''
          });
        });
      }
    }

    return { shifts, errors };
  }

  private isPlannerSheet(sheet: ExcelJS.Worksheet): boolean {
    const { maxRows, maxCols } = this.getScanBounds(sheet);

    for (let r = 1; r <= Math.min(maxRows, 1000); r++) {
      const rowText = this.getRowText(sheet.getRow(r), 1, Math.min(maxCols, 25)).toUpperCase();

      if (rowText.includes('SITE MANAGER') || rowText.includes('DIVIDING LINE')) {
        return true;
      }
    }

    return false;
  }

  private getScanBounds(sheet: ExcelJS.Worksheet): { maxRows: number; maxCols: number } {
    const actualRowCount = Number((sheet as any).actualRowCount || 0);
    const actualColumnCount = Number((sheet as any).actualColumnCount || 0);

    const maxRows = Math.min(
      Math.max(sheet.rowCount || 0, actualRowCount, 1000),
      5000
    );

    const maxCols = Math.min(
      Math.max(sheet.columnCount || 0, actualColumnCount, 120),
      300
    );

    return { maxRows, maxCols };
  }

  private getActualCell(cell: ExcelJS.Cell): ExcelJS.Cell {
    return cell.isMerged && cell.master ? cell.master : cell;
  }

  private getCellText(cell: ExcelJS.Cell): string {
    const actualCell = this.getActualCell(cell);
    return this.valueToText(actualCell.value).replace(/\s+/g, ' ').trim();
  }

  private getRowText(row: ExcelJS.Row, fromCol: number, toCol: number): string {
    const parts: string[] = [];

    for (let c = fromCol; c <= toCol; c++) {
      const text = this.getCellText(row.getCell(c));
      if (text) parts.push(text);
    }

    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  private valueToText(value: any): string {
    if (value === null || value === undefined) return '';

    if (value instanceof Date) {
      return format(value, 'dd/MM/yyyy');
    }

    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
    if (typeof value === 'boolean') return String(value);

    if (typeof value === 'object') {
      if (Array.isArray(value.richText)) {
        return value.richText.map((part: any) => this.valueToText(part?.text)).join('');
      }

      if (Object.prototype.hasOwnProperty.call(value, 'result')) {
        return this.valueToText(value.result);
      }

      if (Object.prototype.hasOwnProperty.call(value, 'text')) {
        return this.valueToText(value.text);
      }

      if (Object.prototype.hasOwnProperty.call(value, 'formula')) {
        return this.valueToText(value.result);
      }
    }

    return '';
  }

  private parseDateValue(value: any): Date | null {
    if (value === null || value === undefined) return null;

    if (value instanceof Date) {
      return this.cleanDate(value);
    }

    if (typeof value === 'number') {
      return this.excelSerialDateToDate(value);
    }

    if (typeof value === 'object') {
      if (Object.prototype.hasOwnProperty.call(value, 'result')) {
        return this.parseDateValue(value.result);
      }

      if (Object.prototype.hasOwnProperty.call(value, 'text')) {
        return this.parseDateText(this.valueToText(value.text));
      }

      if (Array.isArray(value.richText)) {
        return this.parseDateText(this.valueToText(value));
      }

      return null;
    }

    if (typeof value === 'string') {
      return this.parseDateText(value);
    }

    return null;
  }

  private parseDateText(raw: string): Date | null {
    const text = raw.trim();

    if (!text) return null;

    const numeric = Number(text);
    if (Number.isFinite(numeric) && numeric > 20000 && numeric < 80000) {
      return this.excelSerialDateToDate(numeric);
    }

    const iso = text.match(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/);
    if (iso) {
      const year = Number(iso[1]);
      const month = Number(iso[2]);
      const day = Number(iso[3]);
      return this.makeDate(year, month, day);
    }

    const ukFull = text.match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\b/);
    if (ukFull) {
      const day = Number(ukFull[1]);
      const month = Number(ukFull[2]);
      const year = this.normaliseYear(Number(ukFull[3]));
      return this.makeDate(year, month, day);
    }

    const ukNoYear = text.match(/\b(\d{1,2})[\/.](\d{1,2})\b/);
    if (ukNoYear) {
      const day = Number(ukNoYear[1]);
      const month = Number(ukNoYear[2]);
      const year = new Date().getFullYear();
      return this.makeDate(year, month, day);
    }

    return null;
  }

  private excelSerialDateToDate(serial: number): Date | null {
    if (!Number.isFinite(serial)) return null;

    const utcDays = Math.floor(serial - 25569);
    const utcValue = utcDays * 86400;
    const date = new Date(utcValue * 1000);

    return this.cleanDate(
      new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
    );
  }

  private normaliseYear(year: number): number {
    if (year < 100) {
      return year < 50 ? 2000 + year : 1900 + year;
    }

    return year;
  }

  private makeDate(year: number, month: number, day: number): Date | null {
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
      return null;
    }

    if (month < 1 || month > 12 || day < 1 || day > 31) {
      return null;
    }

    return this.cleanDate(new Date(year, month - 1, day));
  }

  private cleanDate(date: Date): Date | null {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      return null;
    }

    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  private findLastUsefulRowInFinalBlock(
    sheet: ExcelJS.Worksheet,
    startRow: number,
    hardEndRow: number,
    dateColumnMap: Map<number, DateColumnInfo>
  ): number {
    let lastUsefulRow = startRow;
    let blankRun = 0;

    for (let r = startRow; r <= hardEndRow; r++) {
      const row = sheet.getRow(r);

      const hasLeftText = Boolean(this.getRowText(row, 1, 5));
      let hasDateAreaText = false;

      dateColumnMap.forEach((_dateInfo, colNumber) => {
        if (this.getCellText(row.getCell(colNumber))) {
          hasDateAreaText = true;
        }
      });

      if (hasLeftText || hasDateAreaText) {
        lastUsefulRow = r;
        blankRun = 0;
      } else {
        blankRun++;
      }

      /**
       * Reasonable safety stop:
       * after the block has had enough room to contain content,
       * stop after 80 totally blank rows.
       */
      if (r > startRow + 30 && blankRun >= 80) {
        break;
      }
    }

    return lastUsefulRow;
  }

  private detectType(task: string): 'am' | 'pm' | 'all-day' {
    const t = ` ${task.toUpperCase()} `;

    if (t.includes(' AM ') || t.includes(' A.M ')) return 'am';
    if (t.includes(' PM ') || t.includes(' P.M ')) return 'pm';

    return 'all-day';
  }
}
