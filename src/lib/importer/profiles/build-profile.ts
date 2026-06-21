/**
 * BUILD PLANNER IMPORT PROFILE
 *
 * Dedicated Build parser.
 *
 * Important:
 * - Do not alter Gas logic.
 * - Build shift dates only exist in the planner grid from column F onwards.
 * - Date-looking values in columns A-E are ignored.
 * - Site addresses are between horizontal divider rows.
 * - Contract is the top pink/contract cell in the left metadata section.
 * - Notes under the contract are ignored.
 * - All visible worksheet tabs are scanned.
 *
 * Shift rules:
 * - Valid Build shifts use: "work description - operative".
 * - Multiple operatives are supported: "task - Nick Hammond & Dan Clowes".
 * - One shift is created per recognised operative.
 * - If one operative is recognised and another is not, the recognised user still gets the shift and only the unknown user is listed as an issue.
 * - Cells without "-" are treated as notes unless they mention a recognised operative, in which case they are flagged as possible missing separator errors.
 */

import ExcelJS from 'exceljs';
import {
  type PlannerProfile,
  type StandardShift,
  type ImportError,
  type UserMapEntry
} from '../types';
import {
  formatDateKey,
  getTodayDateKey,
  findSafeUserMatch,
  getColumnLetter
} from '../core/utils';

type DateColumnMap = Map<number, { date: Date; dateKey: string }>;

interface DateHeaderResult {
  headerRow: number;
  dateColumns: DateColumnMap;
}

interface SiteBlock {
  startRow: number;
  endRow: number;
  address: string;
  contract: string;
}

export class BuildProfile implements PlannerProfile {
  id = 'build-planner';
  name = 'Build Department Planner';
  description = 'Dedicated parser for Build department multi-tab planners.';

  detect(workbook: ExcelJS.Workbook): boolean {
    return workbook.worksheets.some((sheet) => {
      if (sheet.state === 'hidden') return false;

      const firstRows = this.getSheetText(sheet, 1, 20, 1, 12).toUpperCase();
      const dateHeader = this.findDateHeaderColumns(sheet, 6, Math.max(sheet.columnCount, 40));

      return (
        firstRows.includes('DERBYSHIRE CC') ||
        firstRows.includes('NHS PARTNERSHIP') ||
        firstRows.includes('STOKE ON TRENT') ||
        firstRows.includes('BUILD') ||
        dateHeader.dateColumns.size >= 2
      );
    });
  }

  async parse(
    workbook: ExcelJS.Workbook,
    userMap: UserMapEntry[]
  ): Promise<{ shifts: StandardShift[]; errors: ImportError[] }> {
    const shifts: StandardShift[] = [];
    const errors: ImportError[] = [];
    const todayKey = getTodayDateKey();

    for (const sheet of workbook.worksheets) {
      if (sheet.state === 'hidden') continue;

      const result = this.parseSheet(sheet, userMap, todayKey);
      shifts.push(...result.shifts);
      errors.push(...result.errors);
    }

    return {
      shifts,
      errors: errors.sort((a, b) => {
        const rowA = typeof a.row === 'number' ? a.row : 0;
        const rowB = typeof b.row === 'number' ? b.row : 0;
        return rowA - rowB;
      })
    };
  }

  private parseSheet(
    sheet: ExcelJS.Worksheet,
    userMap: UserMapEntry[],
    todayKey: string
  ): { shifts: StandardShift[]; errors: ImportError[] } {
    const shifts: StandardShift[] = [];
    const errors: ImportError[] = [];

    const maxRows = Math.max(sheet.rowCount || 0, 1);
    const maxCols = Math.max(sheet.columnCount || 0, 40);

    /**
     * Build planner rule:
     * Columns A-E are metadata/admin only.
     * Real date grid starts from column F onwards.
     */
    const gridStartCol = 6;

    const dateHeader = this.findDateHeaderColumns(sheet, gridStartCol, maxCols);

    if (dateHeader.dateColumns.size === 0) {
      return { shifts, errors };
    }

    const siteBlocks = this.findSiteBlocks(
      sheet,
      maxRows,
      gridStartCol,
      dateHeader.headerRow + 1
    );

    for (const block of siteBlocks) {
      this.extractShiftsFromBlock(
        sheet,
        block,
        dateHeader,
        userMap,
        todayKey,
        shifts,
        errors
      );
    }

    return { shifts, errors };
  }

  private findDateHeaderColumns(
    sheet: ExcelJS.Worksheet,
    startCol: number,
    maxCols: number
  ): DateHeaderResult {
    let bestHeaderRow = -1;
    let bestMap: DateColumnMap = new Map();
    let bestCount = 0;

    const maxHeaderRow = Math.min(Math.max(sheet.rowCount || 0, 1), 40);

    for (let r = 1; r <= maxHeaderRow; r++) {
      const rowMap: DateColumnMap = new Map();

      for (let c = startCol; c <= maxCols; c++) {
        const cell = sheet.getRow(r).getCell(c);
        const date = this.parseDateValue(cell.value) || this.parseDateValue(this.getCellText(cell));

        if (!date) continue;

        rowMap.set(c, {
          date,
          dateKey: formatDateKey(date)
        });
      }

      if (rowMap.size > bestCount) {
        bestCount = rowMap.size;
        bestHeaderRow = r;
        bestMap = rowMap;
      }
    }

    return {
      headerRow: bestHeaderRow,
      dateColumns: bestMap
    };
  }

  private findSiteBlocks(
    sheet: ExcelJS.Worksheet,
    maxRows: number,
    gridStartCol: number,
    startScanRow: number
  ): SiteBlock[] {
    const blocks: SiteBlock[] = [];
    let current: { startRow: number; endRow: number; address: string } | null = null;

    const closeCurrent = (endRow: number) => {
      if (!current) return;

      const start = current.startRow;
      const end = Math.max(start, endRow);
      const address = current.address.trim();
      const contract = this.extractContract(sheet, start, end);

      if (address.length > 5) {
        blocks.push({
          startRow: start,
          endRow: end,
          address,
          contract
        });
      }

      current = null;
    };

    for (let r = Math.max(1, startScanRow); r <= maxRows; r++) {
      if (this.isHorizontalDividerRow(sheet, r, gridStartCol)) {
        closeCurrent(r - 1);
        continue;
      }

      const address = this.getAddressFromRow(sheet, r);

      if (!address) {
        if (current) current.endRow = r;
        continue;
      }

      if (!this.looksLikeSiteAddress(address)) {
        if (current) current.endRow = r;
        continue;
      }

      if (!current) {
        current = {
          startRow: r,
          endRow: r,
          address
        };
        continue;
      }

      if (this.normaliseCompare(address) !== this.normaliseCompare(current.address)) {
        closeCurrent(r - 1);

        current = {
          startRow: r,
          endRow: r,
          address
        };

        continue;
      }

      current.endRow = r;
    }

    closeCurrent(maxRows);

    return blocks;
  }

  private extractShiftsFromBlock(
    sheet: ExcelJS.Worksheet,
    block: SiteBlock,
    dateHeader: DateHeaderResult,
    userMap: UserMapEntry[],
    todayKey: string,
    outShifts: StandardShift[],
    outErrors: ImportError[]
  ): void {
    for (let r = block.startRow; r <= block.endRow; r++) {
      if (r <= dateHeader.headerRow) continue;

      const row = sheet.getRow(r);

      dateHeader.dateColumns.forEach(({ date, dateKey }, col) => {
        if (dateKey < todayKey) return;

        const cell = row.getCell(col);
        const text = this.getCellText(cell);

        if (!text) return;
        if (this.shouldSilentlyIgnoreGridCell(text)) return;

        const sourceCell = `${getColumnLetter(col)}${r}`;

        const baseContext = {
          row: r,
          cell: sourceCell,
          sheet: sheet.name,
          date: this.formatDisplayDate(date),
          dateKey,
          address: block.address,
          contract: block.contract,
          task: text,
          operative: ''
        };

        const separatorIndex = this.findLastShiftSeparatorIndex(text);

        /**
         * No separator:
         * - If the cell contains no recognised operative, assume it is a Build planner note and ignore it.
         * - If the cell contains a recognised operative, flag it because it is probably a shift missing "-".
         */
        if (separatorIndex === -1) {
          const mentionedOperatives = this.findRecognisedOperativesMentionedInText(text, userMap);

          if (mentionedOperatives.length > 0) {
            outErrors.push({
              ...baseContext,
              operative: mentionedOperatives.map((user) => user.originalName).join(', '),
              message: `Possible Build shift missing "-" separator at ${sourceCell}. Recognised operative name found, but expected "work description - operative".`,
              severity: 'error',
              code: 'MISSING_SEPARATOR'
            });
          }

          return;
        }

        const taskPart = text.substring(0, separatorIndex).trim();
        const namePart = text.substring(separatorIndex + 1).trim();

        if (!taskPart) {
          outErrors.push({
            ...baseContext,
            task: '',
            operative: namePart,
            message: `Missing work description at ${sourceCell}.`,
            severity: 'error',
            code: 'MISSING_TASK'
          });
          return;
        }

        if (!namePart) {
          outErrors.push({
            ...baseContext,
            task: taskPart,
            operative: '',
            message: `Missing operative after "-" at ${sourceCell}.`,
            severity: 'error',
            code: 'MISSING_OPERATIVE'
          });
          return;
        }

        const operativeNames = this.splitOperativeNames(namePart);

        if (operativeNames.length === 0) {
          outErrors.push({
            ...baseContext,
            task: taskPart,
            operative: namePart,
            message: `Missing operative after "-" at ${sourceCell}.`,
            severity: 'error',
            code: 'MISSING_OPERATIVE'
          });
          return;
        }

        for (const operativeName of operativeNames) {
          const matchedUser = findSafeUserMatch(operativeName, userMap);

          if (!matchedUser) {
            outErrors.push({
              ...baseContext,
              task: taskPart,
              operative: operativeName,
              message: `Operative not recognised: ${operativeName}`,
              severity: 'error',
              code: 'USER_NOT_FOUND'
            });
            continue;
          }

          outShifts.push({
            date,
            dateKey,
            address: block.address,
            contract: block.contract,
            operative: matchedUser.originalName,
            operativeUid: matchedUser.uid,
            userId: matchedUser.uid,
            userName: matchedUser.originalName,
            task: taskPart,
            descriptionOfWorks: taskPart,
            type: 'all-day',
            sourceCell,
            sourceSheet: sheet.name,
            sourcePlannerId: sheet.name,
            sourcePlannerName: sheet.name,
            plannerName: sheet.name,
            profileId: this.id,
            importKey: [
              this.id,
              sheet.name,
              dateKey,
              block.address,
              matchedUser.uid,
              taskPart
            ]
              .join('|')
              .toLowerCase()
          });
        }
      });
    }
  }

  private findLastShiftSeparatorIndex(text: string): number {
    const candidates = [
      text.lastIndexOf('-'),
      text.lastIndexOf('–'),
      text.lastIndexOf('—')
    ];

    return Math.max(...candidates);
  }

  private splitOperativeNames(value: string): string[] {
    const cleaned = value
      .replace(/\s+/g, ' ')
      .replace(/\band\b/gi, '&')
      .trim();

    const names = cleaned
      .split(/\s*(?:&|\+|\/|,|;)\s*/g)
      .map((name) => name.trim())
      .filter(Boolean);

    return Array.from(new Set(names.map((name) => this.normaliseNameForOutput(name))));
  }

  private normaliseNameForOutput(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
  }

  private findRecognisedOperativesMentionedInText(
    text: string,
    userMap: UserMapEntry[]
  ): UserMapEntry[] {
    const normalisedText = this.normaliseLoose(text);
    const matched = new Map<string, UserMapEntry>();
    const firstNameCounts = new Map<string, number>();

    for (const user of userMap) {
      const nameParts = this.normaliseLoose(user.originalName).split(' ').filter(Boolean);
      const firstName = nameParts[0];

      if (firstName) {
        firstNameCounts.set(firstName, (firstNameCounts.get(firstName) || 0) + 1);
      }
    }

    for (const user of userMap) {
      const originalName = this.normaliseLoose(user.originalName);
      const storedName = this.normaliseLoose(user.normalizedName || '');
      const parts = originalName.split(' ').filter(Boolean);

      const firstName = parts[0] || '';
      const lastName = parts.length > 1 ? parts[parts.length - 1] : '';

      const fullNameMatch =
        originalName.length >= 4 && this.containsWholePhrase(normalisedText, originalName);

      const storedNameMatch =
        storedName.length >= 4 && this.containsWholePhrase(normalisedText, storedName);

      const firstAndLastMatch =
        firstName.length >= 3 &&
        lastName.length >= 3 &&
        this.containsWholePhrase(normalisedText, firstName) &&
        this.containsWholePhrase(normalisedText, lastName);

      const uniqueFirstNameMatch =
        firstName.length >= 4 &&
        firstNameCounts.get(firstName) === 1 &&
        this.containsWholePhrase(normalisedText, firstName);

      if (fullNameMatch || storedNameMatch || firstAndLastMatch || uniqueFirstNameMatch) {
        matched.set(user.uid, user);
      }
    }

    return Array.from(matched.values());
  }

  private containsWholePhrase(text: string, phrase: string): boolean {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`, 'i').test(text);
  }

  private normaliseLoose(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private shouldSilentlyIgnoreGridCell(text: string): boolean {
    const value = text.trim();
    const upper = value.toUpperCase();

    if (!value) return true;

    /**
     * Date-only cells are not shift attempts.
     */
    if (this.parseDateValue(value)) return true;

    /**
     * Ignore common planner/admin labels if they appear inside the scanned grid.
     */
    const ignoredExact = [
      'NO ACCESS',
      'N/A',
      'NA',
      'TBC',
      'TBA',
      'HOLIDAY',
      'BANK HOLIDAY'
    ];

    if (ignoredExact.includes(upper)) return true;

    /**
     * Ignore cells that are only punctuation/separators.
     */
    if (!/[A-Z0-9]/i.test(value)) return true;

    return false;
  }

  private extractContract(sheet: ExcelJS.Worksheet, startRow: number, endRow: number): string {
    for (let r = startRow; r <= endRow; r++) {
      for (let c = 2; c <= 5; c++) {
        const cell = sheet.getRow(r).getCell(c);
        const text = this.getCellText(cell);

        if (text && this.isPinkCell(cell)) {
          return text;
        }
      }
    }

    /**
     * Fallback:
     * Only look near the top of the block so we do not accidentally import
     * lower admin/user notes as the contract.
     */
    const fallbackEnd = Math.min(endRow, startRow + 4);

    for (let r = startRow; r <= fallbackEnd; r++) {
      for (let c = 2; c <= 5; c++) {
        const text = this.getCellText(sheet.getRow(r).getCell(c));
        if (text) return text;
      }
    }

    return 'Build Works';
  }

  private isHorizontalDividerRow(
    sheet: ExcelJS.Worksheet,
    rowNumber: number,
    gridStartCol: number
  ): boolean {
    const row = sheet.getRow(rowNumber);
    let blackFillCount = 0;
    let thickBorderCount = 0;
    const checkToCol = Math.max(gridStartCol, 8);

    for (let c = 1; c <= checkToCol; c++) {
      const cell = row.getCell(c);

      if (this.isBlackCell(cell)) {
        blackFillCount++;
      }

      const border = (cell as any).border;
      const top = border?.top?.style;
      const bottom = border?.bottom?.style;

      if (
        top === 'thick' ||
        bottom === 'thick' ||
        top === 'medium' ||
        bottom === 'medium' ||
        top === 'double' ||
        bottom === 'double'
      ) {
        thickBorderCount++;
      }
    }

    return blackFillCount >= 2 || thickBorderCount >= 4;
  }

  private getAddressFromRow(sheet: ExcelJS.Worksheet, rowNumber: number): string {
    return this.getCellText(sheet.getRow(rowNumber).getCell(1));
  }

  private looksLikeSiteAddress(text: string): boolean {
    const value = text.trim();
    const upper = value.toUpperCase();

    if (value.length < 8) return false;

    /**
     * Prevent top planner date cells such as 20/06/2026 being treated as addresses.
     */
    if (this.parseDateValue(value)) return false;

    const blockedTerms = [
      'BUILD',
      'BUILDS',
      'CONTRACT',
      'CONTRACTOR',
      'SITE MANAGER',
      'MANAGER',
      'DATE',
      'ADDRESS',
      'PLANNER',
      'SCHEDULE'
    ];

    if (blockedTerms.some((term) => upper === term || upper.includes(`${term}:`))) {
      return false;
    }

    const hasNumber = /\d/.test(value);
    const hasPostcodeFragment = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d?[A-Z]{0,2}\b/i.test(value);
    const hasSeveralWords = value.split(/\s+/).length >= 3;

    return hasNumber || hasPostcodeFragment || hasSeveralWords;
  }

  private parseDateValue(value: any): Date | null {
    if (!value) return null;

    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) return null;
      return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 12, 0, 0);
    }

    if (typeof value === 'number') {
      if (value < 30000 || value > 80000) return null;

      const utcDays = Math.floor(value - 25569);
      const utcValue = utcDays * 86400 * 1000;
      const date = new Date(utcValue);

      return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12, 0, 0);
    }

    if (typeof value === 'object') {
      if ('result' in value) return this.parseDateValue((value as any).result);
      if ('text' in value) return this.parseDateValue((value as any).text);

      if ('richText' in value && Array.isArray((value as any).richText)) {
        const text = (value as any).richText.map((part: any) => part.text || '').join('');
        return this.parseDateValue(text);
      }
    }

    if (typeof value === 'string') {
      const text = value.trim();

      /**
       * Supports:
       * 23/03/2026
       * 23-03-2026
       * 23.03.2026
       * 23/3/26
       */
      const match = text.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);

      if (!match) return null;

      const day = Number(match[1]);
      const month = Number(match[2]);
      let year = Number(match[3]);

      if (!day || !month || !year) return null;

      if (year < 100) {
        year = year >= 70 ? 1900 + year : 2000 + year;
      }

      if (month < 1 || month > 12) return null;
      if (day < 1 || day > 31) return null;

      const date = new Date(year, month - 1, day, 12, 0, 0);

      if (
        date.getFullYear() !== year ||
        date.getMonth() !== month - 1 ||
        date.getDate() !== day
      ) {
        return null;
      }

      return date;
    }

    return null;
  }

  private getCellText(cell: ExcelJS.Cell): string {
    const actualCell = cell.isMerged && (cell as any).master ? (cell as any).master : cell;
    const value = actualCell.value;

    if (value === null || value === undefined) {
      const text = (actualCell as any).text;
      return typeof text === 'string' ? text.trim().replace(/\s+/g, ' ') : '';
    }

    if (value instanceof Date) {
      return this.formatDisplayDate(value);
    }

    if (typeof value === 'object') {
      if ('result' in value) return this.valueToText((value as any).result);
      if ('text' in value) return this.valueToText((value as any).text);

      if ('richText' in value && Array.isArray((value as any).richText)) {
        return (value as any).richText
          .map((part: any) => part.text || '')
          .join('')
          .trim()
          .replace(/\s+/g, ' ');
      }

      const text = (actualCell as any).text;

      if (typeof text === 'string' && text.trim()) {
        return text.trim().replace(/\s+/g, ' ');
      }

      return '';
    }

    return String(value).trim().replace(/\s+/g, ' ');
  }

  private valueToText(value: any): string {
    if (value === null || value === undefined) return '';

    if (value instanceof Date) {
      return this.formatDisplayDate(value);
    }

    return String(value).trim().replace(/\s+/g, ' ');
  }

  private isPinkCell(cell: ExcelJS.Cell): boolean {
    const rgb = this.getCellRgb(cell);
    if (!rgb) return false;

    const { r, g, b } = rgb;

    return r >= 180 && b >= 120 && g <= 230 && r >= g;
  }

  private isBlackCell(cell: ExcelJS.Cell): boolean {
    const rgb = this.getCellRgb(cell);
    if (!rgb) return false;

    return rgb.r <= 40 && rgb.g <= 40 && rgb.b <= 40;
  }

  private getCellRgb(cell: ExcelJS.Cell): { r: number; g: number; b: number } | null {
    const actualCell = cell.isMerged && (cell as any).master ? (cell as any).master : cell;
    const fill = (actualCell as any).fill;
    const argb = fill?.fgColor?.argb || fill?.bgColor?.argb;

    if (!argb || typeof argb !== 'string') return null;

    const clean = argb.replace('#', '').toUpperCase();
    const hex = clean.length === 8 ? clean.substring(2) : clean;

    if (hex.length !== 6) return null;

    const r = Number.parseInt(hex.substring(0, 2), 16);
    const g = Number.parseInt(hex.substring(2, 4), 16);
    const b = Number.parseInt(hex.substring(4, 6), 16);

    if ([r, g, b].some((n) => Number.isNaN(n))) return null;

    return { r, g, b };
  }

  private normaliseCompare(value: string): string {
    return value.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  private formatDisplayDate(date: Date): string {
    return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(
      2,
      '0'
    )}/${date.getFullYear()}`;
  }

  private getSheetText(
    sheet: ExcelJS.Worksheet,
    fromRow: number,
    toRow: number,
    fromCol: number,
    toCol: number
  ): string {
    const parts: string[] = [];

    for (let r = fromRow; r <= toRow; r++) {
      const row = sheet.getRow(r);

      for (let c = fromCol; c <= toCol; c++) {
        const text = this.getCellText(row.getCell(c));
        if (text) parts.push(text);
      }
    }

    return parts.join(' ');
  }
}