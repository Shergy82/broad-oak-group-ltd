/**
 * GAS PLANNER IMPORT PROFILE
 *
 * Gas-only planner profile.
 *
 * This version:
 * - scans every visible worksheet/tab
 * - does not stop after the first tab
 * - uses the real used range instead of fixed row/column caps
 * - handles merged cells without duplicate shifts/errors
 * - prevents bad Excel date values from crashing the import
 * - supports stacked planner sections with multiple date header rows
 * - builds blocks from SITE SECTIONS first, not date rows first
 * - every site block uses its own date header row only
 * - never borrows a date header from a site block above
 * - supports top/first site sections where the date row is near the top of the sheet
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

type DateHeaderRow = {
  rowNumber: number;
  dateColumnMap: Map<number, DateColumnInfo>;
};

type PlannerBlock = {
  blockIndex: number;
  startRow: number;
  endRow: number;
  dateHeader: DateHeaderRow;
};

export class GasProfile implements PlannerProfile {
  id = 'gas-planner';
  name = 'Gas Department Planner';
  description = 'Profile for the Gas department sheet layout.';

  private eNumberRegex = /\b[BE]\d{5,}\b/i;

  detect(workbook: ExcelJS.Workbook): boolean {
    return workbook.worksheets.some(sheet => {
      if (sheet.state === 'hidden') return false;
      return this.isPlannerSheet(sheet);
    });
  }

  async parse(
    workbook: ExcelJS.Workbook,
    userMap: UserMapEntry[]
  ): Promise<{ shifts: StandardShift[]; errors: ImportError[] }> {
    const allShifts: StandardShift[] = [];
    const allErrors: ImportError[] = [];

    const todayKey = getTodayDateKey();

    const processedVisualCells = new Set<string>();
    const seenShiftKeys = new Set<string>();

    const visibleSheets = workbook.worksheets.filter(sheet => sheet.state !== 'hidden');

    if (visibleSheets.length === 0) {
      allErrors.push({
        message: 'No visible worksheets found.',
        severity: 'error',
        code: 'NO_SHEET'
      });

      return { shifts: allShifts, errors: allErrors };
    }

    console.log(
      `[IMPORT DEBUG] Gas workbook tabs=${workbook.worksheets.length} visibleTabs=${visibleSheets.length} parsedTabs=${visibleSheets.length}`
    );
    

    for (const sheet of visibleSheets) {
      const result = this.parseSheet(
        sheet,
        userMap,
        todayKey,
        processedVisualCells,
        seenShiftKeys
      );

      allShifts.push(...result.shifts);
      allErrors.push(...result.errors);
    }

    console.log(
      `[IMPORT DEBUG] Gas workbook parsed shifts=${allShifts.length} issues=${allErrors.length}`
    );

    if (allShifts.length === 0 && allErrors.length === 0) {
      allErrors.push({
        message: 'No shifts were found in any visible Gas workbook tab.',
        severity: 'warning',
        code: 'NO_SHIFTS_FOUND'
      });
    }

    return {
      shifts: allShifts,
      errors: allErrors
    };
  }

  private parseSheet(
    sheet: ExcelJS.Worksheet,
    userMap: UserMapEntry[],
    todayKey: string,
    processedVisualCells: Set<string>,
    seenShiftKeys: Set<string>
  ): { shifts: StandardShift[]; errors: ImportError[] } {
    const shifts: StandardShift[] = [];
    const errors: ImportError[] = [];

    const { maxRows, maxCols } = this.getScanBounds(sheet);

    const dateHeaderRows = this.findDateHeaderRows(sheet, maxRows, maxCols);

    if (dateHeaderRows.length === 0) {
      console.log(
        `[IMPORT DEBUG] Gas skipped tab="${sheet.name}" because no date header rows were found.`
      );

      return { shifts, errors };
    }

    const blocks: PlannerBlock[] = dateHeaderRows.map((dateHeader, index) => {
      const nextDateHeader = dateHeaderRows[index + 1];
    
      const startRow = dateHeader.rowNumber;
      const hardEndRow = nextDateHeader ? nextDateHeader.rowNumber - 1 : maxRows;
    
      const endRow = nextDateHeader
        ? hardEndRow
        : this.findLastUsefulRowInFinalBlock(sheet, startRow, hardEndRow, dateHeader);
    
      return {
        blockIndex: index + 1,
        startRow,
        endRow,
        dateHeader
      };
    });

    for (const block of blocks) {
      const { startRow, endRow, dateHeader } = block;

      let blockAddress = '';
let blockENumber = '';
let blockManager = '';
let blockScheme = '';

const rowAddressByRow = new Map<number, { address: string; eNumber: string }>();
const addressAnchorByRow = new Map<number, { address: string; eNumber: string }>();

      /**
       * Read site/block context from inside this block only.
       * Never look above this block.
       */
      for (let r = startRow; r <= Math.min(startRow + 35, endRow); r++) {
        const row = sheet.getRow(r);

        const colA = this.getCellText(row.getCell(1));
        const colB = this.getCellText(row.getCell(2));
        const colC = this.getCellText(row.getCell(3));
        const colD = this.getCellText(row.getCell(4));
        const rowText = this.getRowText(row, 1, Math.min(maxCols, 8));

        const upperColA = colA.toUpperCase();
        const upperColB = colB.toUpperCase();
        const upperColC = colC.toUpperCase();
        const upperRowText = rowText.toUpperCase();

        if (this.isManagerLabel(upperColA)) {
          blockManager =
            this.extractManagerName(colA) ||
            blockManager;
        }

        if (this.isManagerLabel(upperColB)) {
          blockManager =
            this.extractManagerName(colB) ||
            blockManager;
        }

        if (
          upperColC.includes('SCHEME') ||
          upperColC.includes('CONTRACT') ||
          upperRowText.includes('SCHEME:')
        ) {
          blockScheme = colD || blockScheme;
        }

        const eMatch = rowText.match(this.eNumberRegex);

        if (eMatch && !blockENumber) {
          blockENumber = eMatch[0];
        }

        if (colA && this.isPossibleAddressCell(colA)) {
          const eNumberInAddress = colA.match(this.eNumberRegex);

          if (eNumberInAddress) {
            if (!blockENumber) {
              blockENumber = eNumberInAddress[0];
            }
          
            if (!blockAddress) {
              blockAddress = colA
                .replace(this.eNumberRegex, '')
                .replace(/^\s*[-:–—]\s*/, '')
                .replace(/\s+/g, ' ')
                .trim();
            }
          } else if (!blockAddress) {
            blockAddress = colA.replace(/\s+/g, ' ').trim();
          }
        }
      }
      let currentRowAddress = '';
      let currentRowENumber = '';
      
      for (let addressRowNumber = startRow; addressRowNumber <= endRow; addressRowNumber++) {
        const addressRow = sheet.getRow(addressRowNumber);
        const colA = this.getCellText(addressRow.getCell(1));
      
        if (colA && this.isPossibleAddressCell(colA)) {
          const eNumberInAddress = colA.match(this.eNumberRegex);
      
          if (eNumberInAddress) {
            currentRowENumber = eNumberInAddress[0];
      
            currentRowAddress = colA
              .replace(this.eNumberRegex, '')
              .replace(/^\s*[-:–—]\s*/, '')
              .replace(/\s+/g, ' ')
              .trim();
          } else {
            currentRowAddress = colA.replace(/\s+/g, ' ').trim();
          }
        }
      
        if (colA && this.isPossibleAddressCell(colA) && currentRowAddress) {
          addressAnchorByRow.set(addressRowNumber, {
            address: currentRowAddress,
            eNumber: currentRowENumber
          });
        }
        
        if (currentRowAddress) {
          rowAddressByRow.set(addressRowNumber, {
            address: currentRowAddress,
            eNumber: currentRowENumber
          });
        }
      }

      /**
       * CRITICAL:
       * Every row in this site block uses this site block's own date header only.
       * Do not use nearest-date-header-above logic.
       */
      for (let r = startRow; r <= endRow; r++) {
        const row = sheet.getRow(r);
        const rowAddressInfo =
  addressAnchorByRow.get(r) ||
  addressAnchorByRow.get(r + 1) ||
  addressAnchorByRow.get(r + 2) ||
  rowAddressByRow.get(r);
const shiftAddress = rowAddressInfo?.address || blockAddress || 'Unknown Address';
const shiftENumber = rowAddressInfo?.eNumber || blockENumber || '';

        dateHeader.dateColumnMap.forEach(({ date, dateKey }, colNumber) => {
          const visualCell = row.getCell(colNumber);
          const actualCell = this.getActualCell(visualCell);
          const text = this.getCellText(actualCell);
          
          if (!text) return;

          /**
           * Historic dates are ignored before shift validation and before issue creation.
           */
          if (dateKey < todayKey) return;

          if (!text.includes('-')) return;

          const sourceCellAddress = actualCell.address || visualCell.address;

          const visualCellKey = [
            sheet.name,
            sourceCellAddress,
            dateKey,
            normaliseText(text)
          ].join('|');

          if (processedVisualCells.has(visualCellKey)) return;
          processedVisualCells.add(visualCellKey);

          const lastHyphenIndex = text.lastIndexOf('-');
          const taskPart = text.substring(0, lastHyphenIndex).trim();
          const namePart = text.substring(lastHyphenIndex + 1).trim();

          const context = {
            row: r,
            cell: `${getColumnLetter(colNumber)}${r}`,
            sheet: sheet.name,
            date: this.formatDateForDisplay(date),
            dateKey,
            address: shiftAddress,
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
            sheet.name,
            dateKey,
            normaliseText(blockENumber),
            normaliseText(shiftAddress),
            matchedUser.uid,
            normaliseText(taskPart)
          ].join('|');

          if (seenShiftKeys.has(localDuplicateKey)) return;
          seenShiftKeys.add(localDuplicateKey);

          shifts.push({
            date,
            dateKey,
            address: shiftAddress,
            eNumber: shiftENumber,
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

    console.log(
      `[IMPORT DEBUG] Gas tab="${sheet.name}" parsed shifts=${shifts.length} issues=${errors.length}`
    );

    return { shifts, errors };
  }

  private buildPlannerBlocksFromSiteSections(
    sheet: ExcelJS.Worksheet,
    dateHeaderRows: DateHeaderRow[],
    maxRows: number,
    maxCols: number
  ): PlannerBlock[] {
    const blocks: PlannerBlock[] = [];
    const sectionStartRows = this.findSiteSectionStartRows(sheet, maxRows, maxCols);

    /**
     * Fallback:
     * If the sheet has date headers but no recognised site markers,
     * use the date rows themselves as blocks.
     */
    if (sectionStartRows.length === 0) {
      for (let i = 0; i < dateHeaderRows.length; i++) {
        const dateHeader = dateHeaderRows[i];
        const nextDateHeader = dateHeaderRows[i + 1];

        const startRow = dateHeader.rowNumber;
        const hardEndRow = nextDateHeader ? nextDateHeader.rowNumber - 1 : maxRows;

        const endRow = nextDateHeader
          ? hardEndRow
          : this.findLastUsefulRowInFinalBlock(sheet, startRow, hardEndRow, dateHeader);

        blocks.push({
          blockIndex: i + 1,
          startRow,
          endRow,
          dateHeader
        });
      }

      return blocks;
    }

    for (let i = 0; i < sectionStartRows.length; i++) {
      const startRow = sectionStartRows[i];
      const nextStartRow = sectionStartRows[i + 1];
      const hardEndRow = nextStartRow ? nextStartRow - 1 : maxRows;

      /**
       * The date header must be inside this site section.
       * Never use a date row from the previous site section.
       */
      const dateHeader = this.findDateHeaderInsideSection(
        dateHeaderRows,
        startRow,
        hardEndRow
      );

      if (!dateHeader) {
        console.log(
          `[IMPORT DEBUG] Gas skipped site block tab="${sheet.name}" rows=${startRow}-${hardEndRow} because no date header was found inside this site section.`
        );
        continue;
      }

      const endRow = nextStartRow
        ? hardEndRow
        : this.findLastUsefulRowInFinalBlock(sheet, startRow, hardEndRow, dateHeader);

      blocks.push({
        blockIndex: blocks.length + 1,
        startRow,
        endRow,
        dateHeader
      });
    }

    return blocks;
  }

  private findSiteSectionStartRows(
    sheet: ExcelJS.Worksheet,
    maxRows: number,
    maxCols: number
  ): number[] {
    const rows: number[] = [];

    for (let r = 1; r <= maxRows; r++) {
      const rowText = this.getRowText(sheet.getRow(r), 1, Math.min(maxCols, 25)).toUpperCase();

      /**
       * True section-start markers only.
       * Do not use TECHNICAL MANAGER, CONTRACT MANAGER, MATERIALS, TLO,
       * or address rows as starts because those are inside the same site block.
       */
      const isStart =
        rowText.includes('DIVIDING LINE') ||
        rowText.includes('SITE MANAGER') ||
        rowText.includes('PROJECT/SITE MANAGER') ||
        rowText.includes('PROJECT/SIRE MANAGER') ||
        rowText.includes('TECH MANAGER');

      if (!isStart) continue;

      /**
       * Avoid duplicate starts caused by multiple manager labels
       * in the same header area.
       */
      const previous = rows[rows.length - 1];

      if (previous && r - previous <= 8) {
        continue;
      }

      const startRow = r > 1 ? r - 1 : r;
rows.push(startRow);
    }

    return rows;
  }

  private findDateHeaderInsideSection(
    headers: DateHeaderRow[],
    startRow: number,
    endRow: number
  ): DateHeaderRow | null {
    for (const header of headers) {
      if (header.rowNumber >= startRow && header.rowNumber <= endRow) {
        return header;
      }
    }

    return null;
  }

  private findDateHeaderRows(
    sheet: ExcelJS.Worksheet,
    maxRows: number,
    maxCols: number
  ): DateHeaderRow[] {
    const headers: DateHeaderRow[] = [];

    for (let r = 1; r <= maxRows; r++) {
      const row = sheet.getRow(r);
      const rawDates: Array<{ colNumber: number; date: Date; dateKey: string }> = [];

      for (let colNumber = 6; colNumber <= maxCols; colNumber++) {
        const cell = row.getCell(colNumber);
        const actualCell = this.getActualCell(cell);

        /**
         * Try both the visible cell value and the merged master value.
         * This makes the top row more reliable on awkward merged planners.
         */
        const date = this.parseDateValue(cell.value);

        if (!date) continue;

        const dateKey = formatDateKey(date);

        rawDates.push({
          colNumber,
          date,
          dateKey
        });
      }

      /**
       * A real planner date header row normally contains multiple date columns.
       * This avoids treating random single dates in task text as a header row.
       */
      if (rawDates.length < 2) continue;

      const dateColumnMap = new Map<number, DateColumnInfo>();

      rawDates.sort((a, b) => a.colNumber - b.colNumber);

      for (let i = 0; i < rawDates.length; i++) {
        const current = rawDates[i];
        const next = rawDates[i + 1];

        /**
         * Expand each date across the columns until the next date.
         * This supports planners where a day spans more than one visible column.
         */
        const fromCol = current.colNumber;
        const toCol = next
          ? Math.max(current.colNumber, next.colNumber - 1)
          : current.colNumber;

        for (let c = fromCol; c <= toCol; c++) {
          dateColumnMap.set(c, {
            date: current.date,
            dateKey: current.dateKey
          });
        }
      }
      const previousHeader = headers[headers.length - 1];

if (previousHeader && r - previousHeader.rowNumber <= 12) {
  continue;
}

      headers.push({
        rowNumber: r,
        dateColumnMap
      });
    }

    return headers.sort((a, b) => a.rowNumber - b.rowNumber);
  }

  private isPlannerSheet(sheet: ExcelJS.Worksheet): boolean {
    const { maxRows, maxCols } = this.getScanBounds(sheet);

    let hasPlannerLabel = false;

    for (let r = 1; r <= maxRows; r++) {
      const rowText = this.getRowText(sheet.getRow(r), 1, Math.min(maxCols, 25)).toUpperCase();

      if (
        rowText.includes('TECH MANAGER') ||
        rowText.includes('SITE MANAGER') ||
        rowText.includes('PROJECT/SITE MANAGER') ||
        rowText.includes('PROJECT/SIRE MANAGER') ||
        rowText.includes('DIVIDING LINE')
      ) {
        hasPlannerLabel = true;
        break;
      }
    }

    if (hasPlannerLabel) return true;

    const dateHeaders = this.findDateHeaderRows(sheet, maxRows, maxCols);

    return dateHeaders.length > 0;
  }

  private getScanBounds(sheet: ExcelJS.Worksheet): { maxRows: number; maxCols: number } {
    let maxRows = 1;
    let maxCols = 1;

    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      maxRows = Math.max(maxRows, rowNumber);

      row.eachCell({ includeEmpty: false }, (_cell, colNumber) => {
        maxCols = Math.max(maxCols, colNumber);
      });
    });

    const merges = (sheet as any)._merges;

    if (merges) {
      const mergeValues = merges instanceof Map
        ? Array.from(merges.values())
        : Object.values(merges);

      for (const merge of mergeValues as any[]) {
        const model = merge?.model || merge;

        const bottom = Number(model?.bottom || 0);
        const right = Number(model?.right || 0);

        if (Number.isFinite(bottom) && bottom > 0) {
          maxRows = Math.max(maxRows, bottom);
        }

        if (Number.isFinite(right) && right > 0) {
          maxCols = Math.max(maxCols, right);
        }
      }
    }

    return {
      maxRows,
      maxCols
    };
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
      return this.formatDateForDisplay(value);
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

  private formatDateForDisplay(date: Date): string {
    const clean = this.cleanDate(date);

    if (!clean) return '';

    return format(clean, 'dd/MM/yyyy');
  }

  private parseDateValue(value: any): Date | null {
    if (value === null || value === undefined) return null;

    if (value instanceof Date) {
      return this.cleanDate(value);
    }

    if (typeof value === 'number') {
      if (!Number.isFinite(value) || value < 20000 || value > 80000) {
        return null;
      }

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
    if (!Number.isFinite(serial) || serial < 20000 || serial > 80000) {
      return null;
    }

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

    const date = new Date(year, month - 1, day);

    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return null;
    }

    return this.cleanDate(date);
  }

  private cleanDate(date: Date): Date | null {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      return null;
    }
  
    /**
     * Use midday rather than midnight.
     * This prevents UK timezone/BST conversion from making
     * 22/06 appear as 21/06 when stored/displayed through Firebase.
     */
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0);
  }

  private findLastUsefulRowInFinalBlock(
    sheet: ExcelJS.Worksheet,
    startRow: number,
    hardEndRow: number,
    dateHeader: DateHeaderRow
  ): number {
    let lastUsefulRow = startRow;
    let blankRun = 0;

    for (let r = startRow; r <= hardEndRow; r++) {
      const row = sheet.getRow(r);

      const hasLeftText = Boolean(this.getRowText(row, 1, 5));
      let hasDateAreaText = false;

      /**
       * Use only this final block's own date columns.
       */
      dateHeader.dateColumnMap.forEach((_dateInfo, colNumber) => {
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

      if (r > startRow + 30 && blankRun >= 80) {
        break;
      }
    }

    return lastUsefulRow;
  }

  private isManagerLabel(upperText: string): boolean {
    return (
      upperText.includes('SITE MANAGER') ||
      upperText.includes('PROJECT/SITE MANAGER') ||
      upperText.includes('PROJECT/SIRE MANAGER') ||
      upperText.includes('PROJECT MANAGER') ||
      upperText.includes('TECH MANAGER')
    );
  }

  private extractManagerName(text: string): string {
    return (
      text.split(':')[1]?.trim() ||
      text.split(/SITE MANAGER/i)[1]?.trim() ||
      text.split(/PROJECT\/SITE MANAGER/i)[1]?.trim() ||
      text.split(/PROJECT\/SIRE MANAGER/i)[1]?.trim() ||
      text.split(/PROJECT MANAGER/i)[1]?.trim() ||
      text.split(/TECH MANAGER/i)[1]?.trim() ||
      ''
    );
  }

  private isPossibleAddressCell(value: string): boolean {
    const text = value.replace(/\s+/g, ' ').trim();
    const upper = text.toUpperCase();

    if (!text || text.length < 5) return false;

    if (upper.includes('TECH MANAGER')) return false;
    if (upper.includes('TECHNICAL MANAGER')) return false;
    if (upper.includes('CONTRACT MANAGER')) return false;
    if (upper.includes('SITE MANAGER')) return false;
    if (upper.includes('PROJECT/SITE MANAGER')) return false;
    if (upper.includes('PROJECT/SIRE MANAGER')) return false;
    if (upper.includes('PROJECT MANAGER')) return false;
    if (upper.includes('DIVIDING LINE')) return false;
    if (upper.includes('SCHEME')) return false;
    if (upper.includes('MEASURES')) return false;
    if (upper.includes('ON LIVE')) return false;
    if (upper.includes('A COOLE')) return false;
    if (upper.includes('MATERIALS')) return false;
    if (upper.includes('ORDERING')) return false;
    if (upper.includes('ORDERED')) return false;
    if (upper.includes('START DATE')) return false;
    if (upper.startsWith('TLO ')) return false;

    if (this.eNumberRegex.test(text)) return true;

    const looksLikeAddress =
      /\b(ROAD|RD|STREET|ST|AVENUE|AVE|LANE|LN|DRIVE|DR|CLOSE|CL|WAY|COURT|CT|PLACE|PL|GARDENS|CRESCENT|CRES|DALE|VIEW|TERRACE|WORCESTER|DROITWICH|BIRMINGHAM|HEREFORD|SHROPSHIRE|WORCESTERSHIRE|WR\d|B\d|DY\d|WV\d)\b/i.test(text);

    return looksLikeAddress;
  }

  private detectType(task: string): 'am' | 'pm' | 'all-day' {
    const t = ` ${task.toUpperCase()} `;

    if (t.includes(' AM ') || t.includes(' A.M ')) return 'am';
    if (t.includes(' PM ') || t.includes(' P.M ')) return 'pm';

    return 'all-day';
  }
}