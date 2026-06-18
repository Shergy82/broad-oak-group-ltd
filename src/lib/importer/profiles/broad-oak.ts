import ExcelJS from 'exceljs';
import { type PlannerProfile, type StandardShift, type ImportError, type UserMapEntry } from '../types';

/**
 * Specialized Battleship Parser
 * Handles stateful column scanning between dividers.
 */
export class BroadOakProfile implements PlannerProfile {
  id = 'broad-oak';
  name = 'Broad Oak Gas Planner';
  description = 'Supports stateful Battleship layout with coloured dividers.';

  detect(workbook: ExcelJS.Workbook): boolean {
    const sheet = workbook.worksheets.find(s => s.state !== 'hidden');
    if (!sheet) return false;
    
    let darkRows = 0;
    for (let r = 1; r <= 20; r++) {
      if (this.isDividerRow(sheet.getRow(r))) darkRows++;
    }
    return darkRows > 0;
  }

  private isDividerRow(row: ExcelJS.Row): boolean {
    const cell = row.getCell(1);
    const fill = cell.fill as ExcelJS.FillPattern;
    if (fill?.type === 'pattern' && fill.fgColor) {
      const color = String(fill.fgColor.argb || (fill.fgColor as any).indexed);
      return color === 'FF000000' || color === '64';
    }
    return false;
  }

  async parse(workbook: ExcelJS.Workbook, userMap: UserMapEntry[]): Promise<{ shifts: StandardShift[], errors: ImportError[] }> {
    const shifts: StandardShift[] = [];
    const errors: ImportError[] = [];

    for (const sheet of workbook.worksheets.filter(ws => ws.state !== 'hidden')) {
      const used = this.getUsedBounds(sheet);
      if (!used) continue;

      const dividers: number[] = [];
      for (let r = used.startRow; r <= used.endRow; r++) {
        if (this.isDividerRow(sheet.getRow(r))) dividers.push(r);
      }

      errors.push({ sheet: sheet.name, message: `Detected ${dividers.length} site dividers.`, severity: 'info', code: 'DEBUG_LOG' });

      for (let i = 0; i < dividers.length; i++) {
        const startRow = dividers[i];
        const endRow = dividers[i + 1] ? dividers[i + 1] - 1 : used.endRow;

        const address = this.extractAddress(sheet, startRow, endRow);
        if (!address) {
          errors.push({ row: startRow, sheet: sheet.name, message: 'Skipped block: Could not find address in Column A.', severity: 'debug', code: 'NO_ADDRESS' });
          continue;
        }

        const dateCols = this.getDateColumns(sheet, startRow, endRow);
        if (dateCols.length === 0) continue;

        for (const { col, date } of dateCols) {
          let currentOperative = '';
          let currentTaskParts: string[] = [];
          let currentCellRef = '';

          const flush = () => {
            if (currentOperative) {
              const fullTask = currentTaskParts.join('\n').trim() || 'Work';
              shifts.push({
                date,
                operative: currentOperative,
                address,
                contract: sheet.name,
                task: fullTask.split('\n')[0],
                descriptionOfWorks: fullTask,
                type: this.detectType(fullTask),
                sourceCell: currentCellRef,
                sourceSheet: sheet.name
              });
            }
          };

          for (let r = startRow + 1; r <= endRow; r++) {
            const cell = sheet.getRow(r).getCell(col);
            const text = this.getCellText(cell);
            if (!text) continue;

            const { names, task } = this.extractNamesAndTask(text, userMap);

            if (names.length > 0) {
              flush();
              currentOperative = names[0];
              currentTaskParts = task ? [task] : [];
              currentCellRef = cell.address;
            } else if (currentOperative) {
              currentTaskParts.push(text);
            }
          }
          flush();
        }
      }
    }

    return { shifts, errors };
  }

  private detectType(text: string): 'am' | 'pm' | 'all-day' {
    if (/\bAM\b/i.test(text)) return 'am';
    if (/\bPM\b/i.test(text)) return 'pm';
    return 'all-day';
  }

  private extractNamesAndTask(text: string, userMap: UserMapEntry[]) {
    const normalized = text.toLowerCase().replace(/[^a-z ]/g, ' ').trim();
    const words = normalized.split(/\s+/);
    const foundUser = userMap.find(u => {
      const uWords = u.normalizedName.split(' ');
      return words.some(w => uWords.includes(w) && w.length > 2);
    });
    if (foundUser) {
      return { names: [foundUser.originalName], task: text.replace(new RegExp(foundUser.originalName, 'gi'), '').trim() };
    }
    return { names: [], task: text };
  }

  private getCellText(cell: ExcelJS.Cell): string {
    const v = cell.isMerged ? cell.master.value : cell.value;
    return v ? String(v).trim() : '';
  }

  private getDateColumns(sheet: ExcelJS.Worksheet, start: number, end: number) {
    const cols = [];
    for (let r = start; r <= Math.min(start + 10, end); r++) {
      const row = sheet.getRow(r);
      for (let c = 6; c <= 50; c++) {
        const cell = row.getCell(c);
        const val = cell.value;
        if (val instanceof Date) { cols.push({ col: c, date: new Date(Date.UTC(val.getFullYear(), val.getMonth(), val.getDate(), 12)) }); }
        else if (typeof val === 'number' && val > 40000 && val < 60000) {
          const date = new Date((val - 25569) * 86400 * 1000);
          cols.push({ col: c, date: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12)) });
        }
      }
      if (cols.length > 0) break;
    }
    return cols;
  }

  private extractAddress(sheet: ExcelJS.Worksheet, start: number, end: number): string | null {
    for (let r = start; r <= end; r++) {
      const text = this.getCellText(sheet.getRow(r).getCell(1));
      if (text.length > 5 && /\d/.test(text) && !/ORDERING|MANAGER|TLO/i.test(text)) return text;
    }
    return null;
  }

  private getUsedBounds(ws: ExcelJS.Worksheet) {
    let minRow = Infinity, maxRow = 0;
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      minRow = Math.min(minRow, rowNumber);
      maxRow = Math.max(maxRow, rowNumber);
    });
    return isFinite(minRow) ? { startRow: minRow, endRow: maxRow } : null;
  }
}
